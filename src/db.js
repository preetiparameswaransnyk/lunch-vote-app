import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HttpError, isUniqueConstraint } from "./errors.js";
import { normalizeKey } from "./validate.js";

export const defaultDbPath = path.join(process.cwd(), "data", "lunch.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  lunch_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (poll_id, name_key)
) STRICT;

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  voter_name TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (poll_id, voter_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_options_poll ON options (poll_id);
CREATE INDEX IF NOT EXISTS idx_votes_poll ON votes (poll_id);
CREATE INDEX IF NOT EXISTS idx_votes_option ON votes (option_id);
`;

export function openDatabase(dbPath = defaultDbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 3000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function mapPoll(row) {
  return {
    id: row.id,
    title: row.title,
    lunchDate: row.lunch_date,
    status: row.status,
    createdAt: row.created_at,
    optionCount: row.option_count ?? 0,
    voteCount: row.vote_count ?? 0,
  };
}

function groupOptions(rows) {
  const options = [];
  const byId = new Map();
  for (const row of rows) {
    let option = byId.get(row.id);
    if (!option) {
      option = {
        id: row.id,
        name: row.name,
        description: row.description,
        voteCount: 0,
        voters: [],
      };
      byId.set(row.id, option);
      options.push(option);
    }
    if (row.voter_name) {
      option.voters.push(row.voter_name);
      option.voteCount += 1;
    }
  }
  for (const option of options) {
    option.voters.sort((a, b) => a.localeCompare(b));
  }
  return options;
}

export function listPolls(db) {
  const rows = db
    .prepare(
      `SELECT
         p.id, p.title, p.lunch_date, p.status, p.created_at,
         (SELECT COUNT(*) FROM options o WHERE o.poll_id = p.id) AS option_count,
         (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS vote_count
       FROM polls p
       ORDER BY p.lunch_date DESC, p.id DESC`,
    )
    .all();
  return rows.map(mapPoll);
}

export function getPollRow(db, id) {
  return db
    .prepare(
      "SELECT id, title, lunch_date, status, created_at FROM polls WHERE id = ?",
    )
    .get(id);
}

export function getPollDetail(db, id) {
  const poll = getPollRow(db, id);
  if (!poll) {
    return null;
  }
  const rows = db
    .prepare(
      `SELECT o.id, o.name, o.description, v.voter_name
       FROM options o
       LEFT JOIN votes v ON v.option_id = o.id
       WHERE o.poll_id = ?
       ORDER BY o.id ASC, v.voter_name COLLATE NOCASE ASC`,
    )
    .all(id);
  const options = groupOptions(rows);
  const totalVotes = options.reduce((sum, option) => sum + option.voteCount, 0);
  return {
    id: poll.id,
    title: poll.title,
    lunchDate: poll.lunch_date,
    status: poll.status,
    createdAt: poll.created_at,
    totalVotes,
    options,
  };
}

export function getResults(db, id) {
  const detail = getPollDetail(db, id);
  if (!detail) {
    return null;
  }
  const ranked = [...detail.options].sort((a, b) => {
    if (b.voteCount !== a.voteCount) {
      return b.voteCount - a.voteCount;
    }
    return a.name.localeCompare(b.name);
  });
  const top = ranked[0]?.voteCount ?? 0;
  const leaders = top > 0 ? ranked.filter((option) => option.voteCount === top) : [];
  return {
    pollId: detail.id,
    title: detail.title,
    lunchDate: detail.lunchDate,
    status: detail.status,
    totalVotes: detail.totalVotes,
    tie: leaders.length > 1,
    leaders: leaders.map(({ id: optionId, name, voteCount }) => ({
      id: optionId,
      name,
      voteCount,
    })),
    ranked,
  };
}

export function createPoll(db, { title, lunchDate }) {
  const createdAt = nowIso();
  const result = db
    .prepare(
      "INSERT INTO polls (title, lunch_date, status, created_at) VALUES (?, ?, 'open', ?)",
    )
    .run(title, lunchDate, createdAt);
  return getPollSummary(db, Number(result.lastInsertRowid));
}

function getPollSummary(db, id) {
  const row = db
    .prepare(
      `SELECT
         p.id, p.title, p.lunch_date, p.status, p.created_at,
         (SELECT COUNT(*) FROM options o WHERE o.poll_id = p.id) AS option_count,
         (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS vote_count
       FROM polls p
       WHERE p.id = ?`,
    )
    .get(id);
  return row ? mapPoll(row) : null;
}

export function updatePoll(db, id, fields) {
  const current = getPollRow(db, id);
  if (!current) {
    return null;
  }
  const title = fields.title ?? current.title;
  const lunchDate = fields.lunchDate ?? current.lunch_date;
  const status = fields.status ?? current.status;
  db.prepare(
    "UPDATE polls SET title = ?, lunch_date = ?, status = ? WHERE id = ?",
  ).run(title, lunchDate, status, id);
  return getPollSummary(db, id);
}

export function deletePoll(db, id) {
  const result = db.prepare("DELETE FROM polls WHERE id = ?").run(id);
  return result.changes > 0;
}

function requireOpenPoll(db, pollId) {
  const poll = getPollRow(db, pollId);
  if (!poll) {
    throw new HttpError(404, "Poll not found");
  }
  if (poll.status !== "open") {
    throw new HttpError(409, "Voting is closed for this poll");
  }
  return poll;
}

export function addOption(db, pollId, { name, description }) {
  requireOpenPoll(db, pollId);
  const createdAt = nowIso();
  try {
    const result = db
      .prepare(
        `INSERT INTO options (poll_id, name, name_key, description, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(pollId, name, normalizeKey(name), description, createdAt);
    return db
      .prepare(
        "SELECT id, name, description FROM options WHERE id = ?",
      )
      .get(Number(result.lastInsertRowid));
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new HttpError(409, "That option is already on this poll");
    }
    throw error;
  }
}

export function deleteOption(db, pollId, optionId) {
  requireOpenPoll(db, pollId);
  const result = db
    .prepare("DELETE FROM options WHERE id = ? AND poll_id = ?")
    .run(optionId, pollId);
  return result.changes > 0;
}

export function castVote(db, pollId, { optionId, voterName }) {
  requireOpenPoll(db, pollId);
  const option = db
    .prepare("SELECT id FROM options WHERE id = ? AND poll_id = ?")
    .get(optionId, pollId);
  if (!option) {
    throw new HttpError(400, "That option is not on this poll");
  }
  const timestamp = nowIso();
  const voterKey = normalizeKey(voterName);
  db.prepare(
    `INSERT INTO votes (poll_id, option_id, voter_name, voter_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (poll_id, voter_key) DO UPDATE SET
       option_id = excluded.option_id,
       voter_name = excluded.voter_name,
       updated_at = excluded.updated_at`,
  ).run(pollId, optionId, voterName, voterKey, timestamp, timestamp);
  return db
    .prepare(
      `SELECT poll_id, option_id, voter_name, created_at, updated_at
       FROM votes
       WHERE poll_id = ? AND voter_key = ?`,
    )
    .get(pollId, voterKey);
}

export function mapVote(row) {
  return {
    pollId: row.poll_id,
    optionId: row.option_id,
    voterName: row.voter_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function removeVote(db, pollId, voterName) {
  requireOpenPoll(db, pollId);
  const result = db
    .prepare("DELETE FROM votes WHERE poll_id = ? AND voter_key = ?")
    .run(pollId, normalizeKey(voterName));
  return result.changes > 0;
}
