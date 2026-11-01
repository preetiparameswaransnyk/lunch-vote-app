const state = {
  polls: [],
  selectedId: null,
  detail: null,
  voterName: localStorage.getItem("lunch-ballot-name") || "",
  busy: false,
  pending: null,
};

const banner = document.querySelector("#banner");
const pollList = document.querySelector("#poll-list");
const detail = document.querySelector("#detail");
const voterInput = document.querySelector("#voter-name");
const dateInput = document.querySelector("#poll-date");

voterInput.value = state.voterName;
dateInput.value = todayISO();

document.querySelector("#voter-form").addEventListener("submit", (event) => {
  event.preventDefault();
});

voterInput.addEventListener("input", () => {
  state.voterName = voterInput.value;
  localStorage.setItem("lunch-ballot-name", state.voterName.trim());
  renderDetail();
});

document.querySelector("#create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.title.value;
  const lunchDate = form.lunchDate.value;
  withBusy(async () => {
    const poll = await api("POST", "/api/polls", { title, lunchDate });
    form.title.value = "";
    state.selectedId = poll.id;
    location.hash = `poll-${poll.id}`;
    showBanner("Poll started.");
    await refresh();
  });
});

detail.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || state.busy) {
    return;
  }
  const action = button.dataset.action;
  withBusy(async () => {
    if (action === "status") {
      state.pending = null;
      await api("PATCH", `/api/polls/${state.selectedId}`, { status: button.dataset.status });
      showBanner(button.dataset.status === "closed" ? "Voting is closed." : "Voting is open again.");
    } else if (action === "delete-poll") {
      if (state.pending !== "delete-poll") {
        state.pending = "delete-poll";
        renderDetail();
        showBanner("Click delete again to remove this poll.");
        return;
      }
      state.pending = null;
      await api("DELETE", `/api/polls/${state.selectedId}`);
      state.selectedId = null;
      state.detail = null;
      history.replaceState(null, "", location.pathname);
      showBanner("Poll deleted.");
    } else if (action === "vote") {
      const name = currentName();
      if (!name) {
        voterInput.focus();
        throw new Error("Add your name before voting.");
      }
      await api("POST", `/api/polls/${state.selectedId}/votes`, {
        voterName: name,
        optionId: Number(button.dataset.optionId),
      });
      showBanner("Vote saved.");
    } else if (action === "clear-vote") {
      await api("DELETE", `/api/polls/${state.selectedId}/votes`, { voterName: currentName() });
      showBanner("Vote removed.");
    } else if (action === "delete-option") {
      const token = `option-${button.dataset.optionId}`;
      if (state.pending !== token) {
        state.pending = token;
        renderDetail();
        showBanner("Click remove again to drop this place.");
        return;
      }
      state.pending = null;
      await api("DELETE", `/api/polls/${state.selectedId}/options/${button.dataset.optionId}`);
      showBanner("Option removed.");
    }
    await refresh();
  });
});

detail.addEventListener("submit", (event) => {
  if (event.target.id !== "option-form") {
    return;
  }
  event.preventDefault();
  const form = event.target;
  withBusy(async () => {
    await api("POST", `/api/polls/${state.selectedId}/options`, {
      name: form.name.value,
      description: form.description.value,
    });
    form.reset();
    showBanner("Option added.");
    await refresh();
  });
});

window.addEventListener("hashchange", () => {
  readHash();
  refresh().catch(showError);
});

readHash();
refresh().catch(showError);

function readHash() {
  const match = /^#poll-(\d+)$/.exec(location.hash);
  state.selectedId = match ? Number(match[1]) : null;
}

async function refresh() {
  const payload = await api("GET", "/api/polls");
  state.polls = payload.polls;
  if (state.selectedId && !state.polls.some((poll) => poll.id === state.selectedId)) {
    state.selectedId = state.polls[0]?.id ?? null;
  }
  if (!state.selectedId && state.polls[0]) {
    state.selectedId = state.polls[0].id;
  }
  state.detail = state.selectedId ? await api("GET", `/api/polls/${state.selectedId}`) : null;
  renderPolls();
  renderDetail();
}

function renderPolls() {
  pollList.replaceChildren();
  if (state.polls.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No polls yet. Start one for the next lunch.";
    pollList.append(item);
    return;
  }
  for (const poll of state.polls) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    if (poll.id === state.selectedId) {
      button.setAttribute("aria-current", "true");
    }
    const title = document.createElement("span");
    title.className = "poll-title";
    title.textContent = poll.title;
    const meta = document.createElement("span");
    meta.className = "poll-meta";
    meta.textContent = `${formatDate(poll.lunchDate)} · ${poll.voteCount} ${poll.voteCount === 1 ? "vote" : "votes"}`;
    button.append(title, meta);
    button.addEventListener("click", () => {
      state.selectedId = poll.id;
      location.hash = `poll-${poll.id}`;
      refresh().catch(showError);
    });
    item.append(button);
    pollList.append(item);
  }
}

function renderDetail() {
  detail.replaceChildren();
  if (!state.detail) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Choose a poll or start a new one.";
    detail.append(empty);
    return;
  }

  const poll = state.detail;
  const open = poll.status === "open";
  const name = currentName();
  const mine = name
    ? poll.options.find((option) => option.voters.some((voter) => sameName(voter, name)))
    : null;

  const head = document.createElement("div");
  head.className = "detail-head";
  const headingWrap = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = poll.title;
  const meta = document.createElement("p");
  meta.className = "muted";
  meta.textContent = formatDate(poll.lunchDate);
  const status = document.createElement("span");
  status.className = open ? "status" : "status closed";
  status.textContent = open ? "Open" : "Closed";
  meta.append(" ", status);
  headingWrap.append(heading, meta);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(
    actionButton(open ? "Close voting" : "Reopen voting", "status", {
      status: open ? "closed" : "open",
    }),
    actionButton(state.pending === "delete-poll" ? "Confirm delete" : "Delete", "delete-poll", {}, "quiet"),
  );
  head.append(headingWrap, actions);

  const callout = document.createElement("p");
  callout.className = "callout";
  callout.textContent = summaryText(poll);

  const options = document.createElement("div");
  options.className = "options";
  if (poll.options.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = open ? "Add the first place." : "This poll has no places.";
    options.append(empty);
  }

  const shareBase = Math.max(poll.totalVotes, 1);
  for (const option of poll.options) {
    const card = document.createElement("article");
    card.className = option.id === mine?.id ? "option mine" : "option";
    const top = document.createElement("div");
    top.className = "option-top";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = option.name;
    copy.append(title);
    if (option.description) {
      const description = document.createElement("p");
      description.className = "muted";
      description.textContent = option.description;
      copy.append(description);
    }
    const side = document.createElement("div");
    side.className = "row-actions";
    const count = document.createElement("span");
    count.className = "poll-meta";
    count.textContent = `${option.voteCount} ${option.voteCount === 1 ? "vote" : "votes"}`;
    side.append(count);
    if (open) {
      const vote = actionButton(option.id === mine?.id ? "Your vote" : "Vote", "vote", {
        optionId: String(option.id),
      }, option.id === mine?.id ? "" : "primary");
      vote.setAttribute("aria-pressed", option.id === mine?.id ? "true" : "false");
      side.append(vote);
      const removeLabel = state.pending === `option-${option.id}` ? "Confirm remove" : "Remove";
      side.append(actionButton(removeLabel, "delete-option", { optionId: String(option.id) }, "quiet"));
    }
    top.append(copy, side);

    const meter = document.createElement("div");
    meter.className = "meter";
    meter.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.style.width = `${Math.round((option.voteCount / shareBase) * 100)}%`;
    meter.append(fill);

    card.append(top, meter);
    if (option.voters.length > 0) {
      const voters = document.createElement("p");
      voters.className = "voters";
      voters.textContent = option.voters.join(", ");
      card.append(voters);
    }
    options.append(card);
  }

  detail.append(head, callout, options);

  if (mine && open) {
    detail.append(actionButton("Remove my vote", "clear-vote", {}, "quiet"));
  }

  if (open) {
    const form = document.createElement("form");
    form.id = "option-form";
    form.className = "add-option";
    form.append(
      field("Place", "name", "Corner pho", 80),
      field("Note", "description", "Optional", 280),
    );
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary";
    submit.textContent = "Add place";
    form.append(submit);
    detail.append(form);
  }
}

function field(labelText, name, placeholder, maxLength) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.name = name;
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  input.required = name === "name";
  label.textContent = labelText;
  const id = `option-${name}`;
  input.id = id;
  label.htmlFor = id;
  wrap.append(label, input);
  return wrap;
}

function actionButton(text, action, data, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.dataset.action = action;
  if (className) {
    button.className = className;
  }
  for (const [key, value] of Object.entries(data)) {
    button.dataset[key] = value;
  }
  return button;
}

function summaryText(poll) {
  if (poll.totalVotes === 0) {
    return poll.status === "open" ? "No votes yet." : "Voting is closed with no votes.";
  }
  const top = Math.max(...poll.options.map((option) => option.voteCount));
  const leaders = poll.options.filter((option) => option.voteCount === top);
  const names = leaders.map((option) => option.name).join(" and ");
  if (leaders.length > 1) {
    return poll.status === "closed" ? `Voting is closed. Tie between ${names}.` : `Tie between ${names}.`;
  }
  return poll.status === "closed" ? `Voting is closed. ${names} wins.` : `${names} is ahead.`;
}

function currentName() {
  return voterInput.value.trim();
}

function sameName(left, right) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function withBusy(work) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  try {
    await work();
  } catch (error) {
    showError(error);
  } finally {
    state.busy = false;
  }
}

function showBanner(message) {
  banner.hidden = false;
  banner.textContent = message;
}

function showError(error) {
  showBanner(error.message || "Something went wrong");
}

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) {
    return null;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}
