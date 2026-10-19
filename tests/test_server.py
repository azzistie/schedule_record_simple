import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("journal_server", Path(__file__).resolve().parents[1] / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def sample():
    end = int(time.time() * 1000) - 60000
    return {"version": 1, "records": [{"id": "r1", "title": "阅读", "category": "study", "start": end-3600000, "end": end}], "todos": [], "days": {}}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = server.Store(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_persists_across_restarts_and_has_snapshot(self):
        self.store.write(sample(), 0)
        reopened = server.Store(Path(self.tmp.name))
        self.assertEqual(reopened.read()["state"]["records"][0]["title"], "阅读")
        self.assertEqual(reopened.read()["revision"], 1)
        self.assertTrue(list((Path(self.tmp.name) / "backups").glob("*.sqlite3")))

    def test_conflict_preserves_latest_data(self):
        self.store.write(sample(), 0)
        with self.assertRaises(server.ConflictError):
            self.store.write(server.EMPTY, 0)
        self.assertEqual(len(self.store.read()["state"]["records"]), 1)

    def test_invalid_overlaps_and_future_fail_atomically(self):
        self.store.write(sample(), 0)
        for mutate in [lambda s: s["records"].append({**s["records"][0], "id":"r2"}),
                       lambda s: s["records"][0].update(end=time.time()*1000+60000),
                       lambda s: s["records"][0].update(start=float("nan")),
                       lambda s: s["records"][0].update(category="bad")]:
            state=sample();mutate(state)
            with self.assertRaises(ValueError): self.store.write(state,1)
        self.assertEqual(self.store.read()["revision"],1)

    def test_simultaneous_write_allows_one_winner(self):
        successes=[];conflicts=[]
        def write():
            try: self.store.write(sample(),0); successes.append(1)
            except server.ConflictError: conflicts.append(1)
        threads=[threading.Thread(target=write) for _ in range(4)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual((len(successes),len(conflicts)),(1,3))


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=server.Store(Path(self.tmp.name))
        self.key="test-only-key-not-a-production-secret"
        self.httpd=server.ThreadingHTTPServer(("127.0.0.1",0),server.make_handler(self.store,self.key,0,False))
        self.thread=threading.Thread(target=self.httpd.serve_forever,daemon=True);self.thread.start()
        self.url=f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown();self.httpd.server_close();self.thread.join();self.tmp.cleanup()

    def request(self,path,method="GET",data=None,authorized=True,headers=None):
        h={"Content-Type":"application/json"}
        if authorized:h["Authorization"]="Bearer "+self.key
        h.update(headers or {})
        req=urllib.request.Request(self.url+path,data=json.dumps(data).encode() if data is not None else None,headers=h,method=method)
        try: response=urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:response=e
        with response:return response.status,response.read(),response.headers

    def test_authentication_required_and_no_data_leaked(self):
        for path in ["/api/state","/api/info"]:
            status,body,_=self.request(path,authorized=False);self.assertEqual(status,401);self.assertNotIn(b"records",body)
        self.assertEqual(self.request("/api/health",authorized=False)[0],200)

    def test_full_write_read_and_conflict(self):
        status,_,_=self.request("/api/state","PUT",sample(),headers={"If-Match":"0"});self.assertEqual(status,200)
        status,body,_=self.request("/api/state");self.assertEqual(json.loads(body)["revision"],1)
        status,_,_=self.request("/api/state","PUT",server.EMPTY,headers={"If-Match":"0"});self.assertEqual(status,409)

    def test_cross_origin_write_rejected(self):
        status,_,_=self.request("/api/state","PUT",sample(),headers={"If-Match":"0","Origin":"https://attacker.invalid"})
        self.assertEqual(status,403);self.assertEqual(self.store.read()["revision"],0)

    def test_static_and_path_traversal(self):
        status,body,headers=self.request("/",authorized=False);self.assertEqual(status,200);self.assertIn("时光".encode(),body)
        self.assertEqual(headers["X-Content-Type-Options"],"nosniff")
        for path in ["/../server.py","/%2e%2e/server.py","/..%5cserver.py","/.data/access.key"]:
            self.assertEqual(self.request(path)[0],404)

    def test_invalid_data_has_no_partial_write(self):
        data=sample();data["records"][0]["title"]=""
        self.assertEqual(self.request("/api/state","PUT",data,headers={"If-Match":"0"})[0],400)
        self.assertEqual(self.store.read()["revision"],0)


if __name__ == "__main__":
    unittest.main()
