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


def todo_sample(**fields):
    state = sample()
    state["todos"] = [{"id": "todo-1", "title": "计划阅读", "category": "study", "start": 1000, "end": 2000,
                       "done": False, "notes": "保留备注", **fields}]
    return state


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

    def test_legacy_todos_and_progress_survive_restart(self):
        for done in (False, True):
            clean = server.validate_state(todo_sample(done=done))
            todo = clean["todos"][0]
            self.assertEqual((todo["priority"], todo["progress"], todo["done"]), (0, 100 if done else 0, done))
        original = todo_sample(priority="high", progress=65, done=True)
        saved = self.store.write(original, 0)["state"]
        todo = saved["todos"][0]
        self.assertEqual((todo["priority"], todo["progress"], todo["done"]), (0, 65, False))
        self.assertEqual(todo["notes"], "保留备注")
        reopened = server.Store(Path(self.tmp.name))
        self.assertEqual(reopened.read()["state"], saved)
        self.assertEqual(server.validate_state(json.loads(json.dumps(saved))), saved)
        completed = todo_sample(priority="low", progress=100, done=False)
        self.assertTrue(self.store.write(completed, 1)["state"]["todos"][0]["done"])

    def test_invalid_todo_fields_leave_saved_data_untouched(self):
        self.store.write(todo_sample(priority="high", progress=45), 0)
        previous = self.store.read()
        invalid = [{"progress": value} for value in (-1, 101, 1.5, float("nan"), float("inf"), "50", None, True)]
        invalid += [{"priority": value} for value in ("urgent", "__proto__", "", "1", None, [], ["high"], -1, 1.5, float("nan"), float("inf"), 9007199254740992)]
        for fields in invalid:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.store.write(todo_sample(**fields), 1)
            self.assertEqual(self.store.read(), previous)

    def test_numeric_order_repairs_gaps_per_day_and_migrates_legacy_database_on_read(self):
        base = 1793116800000  # 2026-10-28 00:00 at UTC+8
        data = todo_sample()
        template = data["todos"][0]
        data["todos"] = [
            {**template, "id": "low", "start": base + 3600000, "end": base + 7200000, "priority": "low", "progress": 65},
            {**template, "id": "high", "start": base + 7200000, "end": base + 10800000, "priority": "high", "progress": 100, "done": True},
            {**template, "id": "legacy", "start": base, "end": base + 3600000},
            {**template, "id": "tomorrow", "start": base + 86400000, "end": base + 86460000, "priority": 99},
        ]
        with self.store.connect() as db:
            db.execute("UPDATE journal SET data=? WHERE id=1", (json.dumps(data),))
        migrated = self.store.read()
        self.assertEqual(migrated["revision"], 0)
        self.assertEqual([t["priority"] for t in migrated["state"]["todos"]], [2, 0, 1, 0])
        self.assertEqual([t["id"] for t in migrated["state"]["todos"]], ["low", "high", "legacy", "tomorrow"])
        self.assertEqual(migrated["state"]["records"], data["records"])
        saved = self.store.write(migrated["state"], 0)["state"]
        self.assertEqual([t["priority"] for t in saved["todos"]], [2, 0, 1, 0])
        self.assertEqual([t["progress"] for t in saved["todos"]], [65, 100, 0, 0])
        # Duplicate numeric ranks are resolved by time; holes close without changing array order.
        saved["todos"][0]["priority"] = 4
        saved["todos"][1]["priority"] = 4
        saved["todos"][2]["priority"] = 9
        repaired = self.store.write(saved, 1)["state"]
        self.assertEqual([t["priority"] for t in repaired["todos"]], [0, 1, 2, 0])
        self.assertEqual(server.Store(Path(self.tmp.name)).read()["state"], repaired)

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

    def test_todo_priority_and_progress_roundtrip_over_existing_state_api(self):
        data = todo_sample(priority="high", progress=75)
        status, body, _ = self.request("/api/state", "PUT", data, headers={"If-Match": "0"})
        self.assertEqual(status, 200)
        saved = json.loads(body)
        self.assertEqual(set(saved), {"revision", "state"})
        self.assertEqual(saved["state"]["version"], 1)
        status, body, _ = self.request("/api/state")
        self.assertEqual(status, 200)
        todo = json.loads(body)["state"]["todos"][0]
        self.assertEqual((todo["priority"], todo["progress"], todo["done"]), (0, 75, False))
        data["todos"][0]["progress"] = 100
        status, body, _ = self.request("/api/state", "PUT", data, headers={"If-Match": "1"})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["state"]["todos"][0]["done"])
        data["todos"][0]["progress"] = -1
        self.assertEqual(self.request("/api/state", "PUT", data, headers={"If-Match": "2"})[0], 400)
        self.assertEqual(self.store.read()["revision"], 2)

    def test_reordered_snapshot_and_deletion_keep_dense_priorities_over_api(self):
        data = todo_sample(priority=0, progress=60)
        template = data["todos"][0]
        data["todos"] = [{**template, "id": "a", "priority": 0}, {**template, "id": "b", "priority": 1},
                         {**template, "id": "c", "priority": 2}]
        self.assertEqual(self.request("/api/state", "PUT", data, headers={"If-Match": "0"})[0], 200)
        # Client places c at 0 and shifts a/b. Array order remains unchanged for exports.
        for todo, rank in zip(data["todos"], (1, 2, 0)):
            todo["priority"] = rank
        status, body, _ = self.request("/api/state", "PUT", data, headers={"If-Match": "1"})
        self.assertEqual(status, 200)
        saved = json.loads(body)["state"]
        self.assertEqual([t["id"] for t in sorted(saved["todos"], key=lambda t: t["priority"])], ["c", "a", "b"])
        saved["todos"] = [t for t in saved["todos"] if t["id"] != "a"]
        status, body, _ = self.request("/api/state", "PUT", saved, headers={"If-Match": "2"})
        self.assertEqual(status, 200)
        todos = json.loads(body)["state"]["todos"]
        self.assertEqual([(t["id"], t["priority"], t["progress"]) for t in todos], [("b", 1, 60), ("c", 0, 60)])
        self.assertEqual(self.request("/api/state", "PUT", data, headers={"If-Match": "1"})[0], 409)

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
