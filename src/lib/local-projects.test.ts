import { test } from "node:test";
import assert from "node:assert/strict";
import { useSync } from "./store";

test("my # projects: rename carries to their tickets; delete hides them and unlinks projects", () => {
  const s = useSync.getState();
  const id = s.addLocalProject("Personal");
  const t = s.addTicket({ projectId: id, projectName: "Personal", title: "Fix bike" });
  const c = s.addCampaign({ name: "Spring", activityIds: [], tags: [id, "p1"] });

  useSync.getState().renameLocalProject(id, "  Home  ");
  let st = useSync.getState();
  assert.equal(st.settings.localProjects?.find((p) => p.id === id)?.name, "Home");
  assert.equal(st.tickets.find((x) => x.id === t)?.projectName, "Home");

  useSync.getState().deleteLocalProject(id);
  st = useSync.getState();
  assert.equal(st.settings.localProjects?.some((p) => p.id === id), false);
  // kept in the data, just hidden
  assert.equal(st.tickets.find((x) => x.id === t)?.hidden, true);
  assert.deepEqual(st.campaigns.find((x) => x.id === c)?.tags, ["p1"]);
});
