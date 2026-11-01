import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

describe("lunch ballot API", () => {
  let server;
  let db;
  let base;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lunch-ballot-"));
    const created = createApp({ dbPath: path.join(dir, "lunch.sqlite") });
    db = created.db;
    server = await new Promise((resolve) => {
      const listening = created.app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    db.close();
  });

  it("serves health, the page, and a JSON 404", async () => {
    const health = await request("GET", "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.json, { ok: true });
    assert.equal(health.headers.get("x-powered-by"), null);
    assert.match(health.headers.get("content-security-policy"), /default-src 'self'/);

    const page = await request("GET", "/");
    assert.equal(page.status, 200);
    assert.match(page.text, /Lunch Ballot/);

    const missing = await request("GET", "/api/missing");
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, "Not found");
  });

  it("creates a poll, rejects bad input, and keeps text literal", async () => {
    const missing = await request("POST", "/api/polls", {});
    assert.equal(missing.status, 400);

    const badDate = await request("POST", "/api/polls", {
      title: "Lunch",
      lunchDate: "2026-02-31",
    });
    assert.equal(badDate.status, 400);

    const title = "Robert'); DROP TABLE polls;--";
    const created = await request("POST", "/api/polls", {
      title,
      lunchDate: "2026-10-30",
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.title, title);
    assert.equal(created.json.status, "open");

    const listed = await request("GET", "/api/polls");
    assert.equal(listed.status, 200);
    assert.ok(listed.json.polls.some((poll) => poll.title === title));
  });

  it("adds options, votes once per person, and ranks a tie", async () => {
    const poll = await request("POST", "/api/polls", {
      title: "Thursday lunch",
      lunchDate: "2026-11-05",
    });
    const pollId = poll.json.id;

    const pho = await request("POST", `/api/polls/${pollId}/options`, {
      name: "Corner pho",
      description: "Herbs and broth",
    });
    assert.equal(pho.status, 201);
    const tacos = await request("POST", `/api/polls/${pollId}/options`, {
      name: "Taco window",
    });
    const duplicate = await request("POST", `/api/polls/${pollId}/options`, {
      name: "corner pho",
    });
    assert.equal(duplicate.status, 409);

    const otherPoll = await request("POST", "/api/polls", {
      title: "Elsewhere",
      lunchDate: "2026-11-06",
    });
    const outsider = await request("POST", `/api/polls/${pollId}/votes`, {
      voterName: "Ada",
      optionId: 999999,
    });
    assert.equal(outsider.status, 400);

    const first = await request("POST", `/api/polls/${pollId}/votes`, {
      voterName: "Ada",
      optionId: pho.json.id,
    });
    assert.equal(first.status, 200);
    const changed = await request("POST", `/api/polls/${pollId}/votes`, {
      voterName: " ada ",
      optionId: tacos.json.id,
    });
    assert.equal(changed.json.optionId, tacos.json.id);
    assert.equal(changed.json.voterName, "ada");

    await request("POST", `/api/polls/${pollId}/votes`, {
      voterName: "Lin",
      optionId: pho.json.id,
    });

    const detail = await request("GET", `/api/polls/${pollId}`);
    assert.equal(detail.json.totalVotes, 2);
    const tacoVotes = detail.json.options.find((option) => option.id === tacos.json.id);
    assert.deepEqual(tacoVotes.voters, ["ada"]);

    const results = await request("GET", `/api/polls/${pollId}/results`);
    assert.equal(results.json.tie, true);
    assert.equal(results.json.leaders.length, 2);
    assert.equal(results.json.ranked[0].voteCount, 1);

    const closed = await request("PATCH", `/api/polls/${pollId}`, { status: "closed" });
    assert.equal(closed.json.status, "closed");
    const rejected = await request("POST", `/api/polls/${pollId}/votes`, {
      voterName: "Sam",
      optionId: pho.json.id,
    });
    assert.equal(rejected.status, 409);
    const rejectedOption = await request("POST", `/api/polls/${pollId}/options`, {
      name: "Salad bar",
    });
    assert.equal(rejectedOption.status, 409);

    await request("PATCH", `/api/polls/${pollId}`, { status: "open" });
    const removed = await request("DELETE", `/api/polls/${pollId}/options/${pho.json.id}`);
    assert.equal(removed.status, 204);
    const afterDelete = await request("GET", `/api/polls/${pollId}`);
    assert.equal(afterDelete.json.options.length, 1);
    assert.equal(afterDelete.json.totalVotes, 1);

    const cleared = await request(
      "DELETE",
      `/api/polls/${pollId}/votes?voterName=${encodeURIComponent("Ada")}`,
    );
    assert.equal(cleared.status, 204);

    const gone = await request("DELETE", `/api/polls/${otherPoll.json.id}`);
    assert.equal(gone.status, 204);
    const missingPoll = await request("GET", `/api/polls/${otherPoll.json.id}`);
    assert.equal(missingPoll.status, 404);
  });

  it("rejects malformed JSON", async () => {
    const response = await fetch(`${base}/api/polls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, "Request body must be JSON");
  });

  async function request(method, urlPath, body) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: body
        ? { "content-type": "application/json", accept: "application/json" }
        : { accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const type = response.headers.get("content-type") || "";
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: type.includes("application/json") && text ? JSON.parse(text) : null,
    };
  }
});
