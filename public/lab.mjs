const form = document.querySelector("[data-lab-form]");
const input = document.querySelector("[data-lab-control='name']");
const status = document.querySelector("[data-lab-status]");
const counter = document.querySelector("[data-lab-counter]");
const actionLog = document.querySelector("[data-lab-action-log]");

let saveCount = 0;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = input.value.trim();
  saveCount += 1;
  status.textContent = name ? `Saved: ${name}` : "Saved: <empty>";
  counter.textContent = String(saveCount);
  appendAction(`Saved: ${name}`);
});

function appendAction(text) {
  const item = document.createElement("li");
  item.textContent = text;
  actionLog.prepend(item);
}
