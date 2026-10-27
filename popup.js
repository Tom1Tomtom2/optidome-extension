"use strict";

// The popup: the grade for the month, the good habits, a tip, and the image
// to share. Read only, except "Clear everything". No technical terms on
// screen: token totals stay in the export.

const NS = "http://www.w3.org/2000/svg";
document.getElementById('open-analysis').addEventListener('click', () => {
  chrome.windows.create({ url: chrome.runtime.getURL('analyse/index.html'), type: 'popup', width: 470, height: 740 });
});
// The text follows Chrome's language (_locales), English by default; numbers
// and dates follow the same language.
const t = (key, ...substitutions) => chrome.i18n.getMessage(key, substitutions.map(String));
const LANG = chrome.i18n.getUILanguage();
const month = new Date().toISOString().slice(0, 7);
const monthName = new Date().toLocaleDateString(LANG, { month: "long", year: "numeric" });

const HABITS = ["newConversation", "dataRemoved"];
const WEEKLY_TIPS = ["weeklyTip1", "weeklyTip2", "weeklyTip3", "weeklyTip4"];

function drawLogo() {
  const logo = document.getElementById("logo");
  logo.setAttribute("viewBox", DOME_VIEWBOX);
  for (const [d, attributes] of [
    [DOME_PATH, { fill: "currentColor", stroke: "currentColor", "stroke-width": "1.1", "stroke-linejoin": "round" }],
    [DOME_LINE, { fill: "none", stroke: "#FF6D00", "stroke-width": "4.572", "stroke-linecap": "round" }],
  ]) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    for (const [name, value] of Object.entries(attributes)) path.setAttribute(name, value);
    logo.append(path);
  }
}

const percent = (share) => share.toLocaleString(LANG, { style: "percent", maximumFractionDigits: 0 });

// "your" in the popup, "my" in the image people share.
function gradeSentence(grade, mine = false) {
  if (grade.longTurns === 0) return t(mine ? "shareNotePhraseNone" : "notePhraseNone");
  return t(mine ? "shareNotePhrase" : "notePhrase", percent(grade.share));
}

function showGrade(grade) {
  document.getElementById("with-grade").hidden = !grade.letter;
  document.getElementById("no-grade").hidden = Boolean(grade.letter);

  const scale = document.getElementById("scale");
  scale.textContent = "";
  // The thresholds are in "How the grade is calculated": under each letter,
  // they made the popup overflow the height Chrome gives it.
  for (const letter of "ABCDE") {
    const box = document.createElement("div");
    if (letter === grade.letter) box.className = "current";
    const name = document.createElement("strong");
    name.textContent = letter;
    box.append(name);
    scale.append(box);
  }

  const nextStep = document.getElementById("next-step");
  nextStep.textContent = "";
  const start = document.createElement("strong");
  if (grade.letter === "A") {
    start.textContent = t("bravo");
    nextStep.append(start, " ", t("keepItUp"));
  } else {
    const next = grade.letter ? "ABCDE"["ABCDE".indexOf(grade.letter) - 1] : "A";
    start.textContent = t("toReach", next);
    nextStep.append(start, " ", t("toReachText"));
  }

  if (!grade.letter) return;
  document.getElementById("letter").textContent = grade.letter;
  document.getElementById("label").textContent = t(`grade_${grade.letter}`);
  document.getElementById("sentence").textContent = gradeSentence(grade);
}

function showHabits(ofMonth) {
  const list = document.getElementById("habits");
  list.textContent = "";
  const rows = HABITS.filter((type) => (ofMonth[type] ?? 0) > 0);
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = t("noHabitsYet");
    list.append(empty);
    return;
  }
  for (const type of rows) {
    const row = document.createElement("div");
    row.className = "habit";
    const check = document.createElement("span");
    check.className = "check";
    const drawing = document.createElementNS(NS, "svg");
    for (const [name, value] of Object.entries({ width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
      drawing.setAttribute(name, value);
    }
    const stroke = document.createElementNS(NS, "path");
    stroke.setAttribute("d", "m3.5 8.5 3 3 6-6.5");
    drawing.append(stroke);
    check.append(drawing);
    const text = document.createElement("span");
    text.textContent = t(`habit_${type}`);
    const count = document.createElement("strong");
    count.textContent = String(ofMonth[type]);
    row.append(check, text, count);
    list.append(row);
  }
}

// A readable range: two decimals under €1, one under €10.
function euroRange({ low, high }) {
  const digits = high < 1 ? 2 : high < 10 ? 1 : 0;
  const format = (n) =>
    n.toLocaleString(LANG, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });
  return t("costRange", format(low), format(high));
}

const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(LANG, { day: "numeric", month: "long", year: "numeric" });

function showUsage(usage) {
  const number = new Intl.NumberFormat(LANG);
  document.getElementById("messages").textContent = number.format(usage.messages);
  document.getElementById("messages-label").textContent = t(usage.messages > 1 ? "messageMany" : "messageOne");
  document.getElementById("conversations").textContent = number.format(usage.conversations);
  document.getElementById("conversations-label").textContent = t(usage.conversations > 1 ? "conversationMany" : "conversationOne");

  const cost = document.getElementById("cost");
  const calc = document.getElementById("calc");
  cost.hidden = calc.hidden = !usage.euros;
  if (!usage.euros) return;

  cost.textContent = "";
  const amount = document.createElement("strong");
  amount.textContent = euroRange(usage.euros);
  cost.append(t("costBefore"), " ", amount, ".");

  const { PRICES, DOLLARS_PER_EURO, RATE_DATE } = Grade;
  document.getElementById("calc-text").textContent = t(
    "calcText",
    PRICES.model,
    longDate(PRICES.recordedOn),
    longDate(RATE_DATE),
    DOLLARS_PER_EURO.toLocaleString(LANG, { maximumFractionDigits: 4 })
  );
}

function weeklyTip() {
  const week = Math.floor(Date.now() / (7 * 86400000));
  return t(WEEKLY_TIPS[week % WEEKLY_TIPS.length]);
}

async function render() {
  const { journal = {}, registry = {}, habits = {} } = await chrome.storage.local.get(["journal", "registry", "habits"]);
  const grade = Grade.gradeForMonth(journal, month);
  const ofMonth = habits[month] ?? {};

  document.getElementById("month").textContent = monthName;
  showGrade(grade);
  showUsage(Grade.usageForMonth(journal, registry, month));
  showHabits(ofMonth);
  document.getElementById("weekly-tip").textContent = weeklyTip();

  const share = document.getElementById("share");
  share.disabled = !grade.letter;
  document.getElementById("share-text").textContent = t(grade.letter ? "shareGrade" : "gradeComingSoon");
  share.onclick = () => downloadShareImage(grade, Object.values(ofMonth).reduce((s, n) => s + n, 0));
}

// --- The share image -----------------------------------------------------------
//
// Drawn in the browser, then downloaded: nothing is sent to produce it. Layout
// from the mockups approved on 2026-10-22.

function splitIntoLines(c, text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const attempt = line ? `${line} ${word}` : word;
    if (c.measureText(attempt).width > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  return [...lines, line];
}

function drawDome(c, x, y, size, color) {
  c.save();
  c.translate(x, y);
  c.scale(size / 40.87, size / 40.87);
  c.translate(-122.45, -60.73);
  const dome = new Path2D(DOME_PATH);
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineWidth = 1.1;
  c.lineJoin = "round";
  c.fill(dome);
  c.stroke(dome);
  c.strokeStyle = "#FF6D00";
  c.lineWidth = 4.572;
  c.lineCap = "round";
  c.stroke(new Path2D(DOME_LINE));
  c.restore();
}

async function downloadShareImage(grade, habitCount) {
  // Without Onest, the image is drawn with the system font rather than not at all.
  await Promise.all([document.fonts.load('700 100px "Onest"'), document.fonts.load('400 24px "Onest"')]).catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const c = canvas.getContext("2d");
  const font = (weight, size) => `${weight} ${size}px "Onest", system-ui, sans-serif`;
  c.fillStyle = "#FFFFFF";
  c.fillRect(0, 0, 1200, 630);
  c.textBaseline = "alphabetic";

  // Header: the logo, the name, the month.
  drawDome(c, 72, 56, 40, "#131312");
  c.fillStyle = "#131312";
  c.font = font(600, 26);
  c.fillText("optidome", 124, 86);
  c.fillStyle = "#5A5955";
  c.font = font(600, 15);
  c.letterSpacing = "1.2px";
  c.textAlign = "right";
  c.fillText(t("shareHeader", monthName.toLocaleUpperCase(LANG)), 1128, 84);
  c.textAlign = "left";
  c.letterSpacing = "0px";

  // The grade inside its dome, resting on the line.
  c.fillStyle = "#131312";
  c.beginPath();
  c.roundRect(85, 170, 210, 180, [105, 105, 16, 16]);
  c.fill();
  c.fillStyle = "#FF6D00";
  c.beginPath();
  c.roundRect(72, 362, 236, 16, 8);
  c.fill();
  c.fillStyle = "#FFFFFF";
  c.font = font(700, 118);
  c.textAlign = "center";
  c.fillText(grade.letter, 190, 326);
  c.textAlign = "left";

  // The label, the sentence, the scale.
  c.fillStyle = "#131312";
  c.font = font(700, 54);
  c.fillText(t(`grade_${grade.letter}`), 344, 222);
  c.fillStyle = "#2E2D2A";
  c.font = font(400, 24);
  let y = 266;
  for (const line of splitIntoLines(c, gradeSentence(grade, true), 430)) {
    c.fillText(line, 344, y);
    y += 32;
  }
  y += 12;
  c.font = font(600, 20);
  c.textAlign = "center";
  [..."ABCDE"].forEach((letter, i) => {
    const x = 344 + i * 60;
    const current = letter === grade.letter;
    c.beginPath();
    c.roundRect(x, y, 52, 36, 18);
    c.fillStyle = current ? "#FF6D00" : "#FFFFFF";
    c.fill();
    c.strokeStyle = current ? "#FF6D00" : "#D9D8D3";
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = current ? "#131312" : "#5A5955";
    c.fillText(letter, x + 26, y + 25);
  });
  c.textAlign = "left";

  // The bars: what ChatGPT rereads, message after message.
  const heights = [12, 20, 32, 46, 64, 86, 112, 142, 176, 212, 250];
  const colors = ["#ECEBE8", "#ECEBE8", "#ECEBE8", "#ECEBE8", "#D9D8D3", "#D9D8D3", "#D9D8D3", "#131312", "#131312", "#FF6D00", "#FF6D00"];
  heights.forEach((height, i) => {
    c.fillStyle = colors[i];
    c.beginPath();
    c.roundRect(806 + i * 30, 440 - height, 22, height, 4);
    c.fill();
  });

  // Footer: the good habits, and the bridge to the company.
  c.fillStyle = "#ECEBE8";
  c.fillRect(72, 500, 1056, 1);
  c.fillStyle = "#FFF1E6";
  c.beginPath();
  c.arc(85, 553, 13, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#B54D00";
  c.lineWidth = 2.2;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(79, 553.5);
  c.lineTo(83, 557.5);
  c.lineTo(91, 548.5);
  c.stroke();
  c.fillStyle = "#131312";
  c.font = font(500, 18);
  const habits = habitCount === 0 ? t("shareNoHabit") : habitCount === 1 ? t("shareHabitOne") : t("shareHabitMany", habitCount);
  c.fillText(habits, 108, 559);
  c.textAlign = "right";
  c.font = font(600, 18);
  c.fillText("optidome.app", 1128, 559);
  const width = c.measureText("optidome.app").width;
  c.fillStyle = "#5A5955";
  c.font = font(400, 18);
  c.fillText(`${t("shareQuestion")} `, 1128 - width, 559);
  c.textAlign = "left";

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `optidome-grade-${month}.png`;
  link.click();
}

// --- Your data -----------------------------------------------------------------

document.getElementById("data-button").addEventListener("click", (event) => {
  const block = document.getElementById("data");
  block.hidden = !block.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!block.hidden));
});

document.getElementById("export").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["journal", "registry", "habits"]);
  const file = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = `optidome-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.clear();
  render();
});

document.documentElement.lang = LANG;
for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
drawLogo();
render();
