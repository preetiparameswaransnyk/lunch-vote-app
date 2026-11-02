import { Router } from "express";
import {
  addOption,
  castVote,
  createPoll,
  deleteOption,
  deletePoll,
  getPollDetail,
  getResults,
  listPolls,
  mapVote,
  removeVote,
  updatePoll,
} from "../db.js";
import { HttpError } from "../errors.js";
import {
  lunchDate,
  optionDescription,
  optionName,
  pollStatus,
  pollTitle,
  readBody,
  requireId,
  voterName,
} from "../validate.js";

function requirePoll(poll) {
  if (!poll) {
    throw new HttpError(404, "Poll not found");
  }
  return poll;
}

export function pollsRouter(db) {
  const router = Router();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  router.get("/polls", (req, res) => {
    res.json({ polls: listPolls(db) });
  });

  router.post("/polls", (req, res) => {
    const body = readBody(req.body);
    const poll = createPoll(db, {
      title: pollTitle(body.title),
      lunchDate: lunchDate(body.lunchDate),
    });
    res.status(201).location(`/api/polls/${poll.id}`).json(poll);
  });

  // DEMO: intentionally vulnerable endpoints for Snyk PR check demo
  router.get("/polls/search", (req, res) => {
    const q = req.query.q;
    const rows = db
      .prepare(`SELECT id, title, lunch_date FROM polls WHERE title LIKE '%${q}%'`)
      .all();
    res.json({ polls: rows });
  });

  router.get("/search-page", (req, res) => {
    res.send(`<h1>Results for ${req.query.q}</h1>`);
  });

  router.get("/polls/:id", (req, res) => {
    const id = requireId(req.params.id, "Poll id");
    res.json(requirePoll(getPollDetail(db, id)));
  });

  router.get("/polls/:id/results", (req, res) => {
    const id = requireId(req.params.id, "Poll id");
    res.json(requirePoll(getResults(db, id)));
  });

  router.patch("/polls/:id", (req, res) => {
    const id = requireId(req.params.id, "Poll id");
    const body = readBody(req.body);
    const fields = {};
    if ("title" in body) {
      fields.title = pollTitle(body.title);
    }
    if ("lunchDate" in body) {
      fields.lunchDate = lunchDate(body.lunchDate);
    }
    if ("status" in body) {
      fields.status = pollStatus(body.status);
    }
    if (Object.keys(fields).length === 0) {
      throw new HttpError(400, "Provide a title, lunch date, or status to update");
    }
    res.json(requirePoll(updatePoll(db, id, fields)));
  });

  router.delete("/polls/:id", (req, res) => {
    const id = requireId(req.params.id, "Poll id");
    if (!deletePoll(db, id)) {
      throw new HttpError(404, "Poll not found");
    }
    res.status(204).end();
  });

  router.post("/polls/:id/options", (req, res) => {
    const id = requireId(req.params.id, "Poll id");
    const body = readBody(req.body);
    const option = addOption(db, id, {
      name: optionName(body.name),
      description: optionDescription(body.description),
    });
    res.status(201).json({
      id: option.id,
      pollId: id,
      name: option.name,
      description: option.description,
    });
  });

  router.delete("/polls/:id/options/:optionId", (req, res) => {
    const id = requireId(req.params.id, "Poll id");
    const optionId = requireId(req.params.optionId, "Option id");
    if (!deleteOption(db, id, optionId)) {
      throw new HttpError(404, "Option not found");
    }
    res.status(204).end();
  });

  router.post("/polls/:id/votes", (req, res) => {
    const id = requireId(req.params.id, "Poll id");
    const body = readBody(req.body);
    const vote = castVote(db, id, {
      optionId: requireId(body.optionId, "Option id"),
      voterName: voterName(body.voterName),
    });
    res.json(mapVote(vote));
  });

  router.delete("/polls/:id/votes", (req, res) => {
    const id = requireId(req.params.id, "Poll id");
    const body = readBody(req.body);
    const name = voterName(body.voterName ?? req.query.voterName);
    if (!removeVote(db, id, name)) {
      throw new HttpError(404, "Vote not found");
    }
    res.status(204).end();
  });

  router.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return router;
}
