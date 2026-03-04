"use strict";

/**
 * Ziel:
 * - Standardrezepte kommen aus data/recipes.json (repo, leicht editierbar)
 * - Eigene Rezepte werden lokal gespeichert (localStorage)
 * - Beim Start: merge JSON + local
 * - Tabs, Portionen, Bewertung, Zutaten-Auswahl, Einkaufsliste etc.
 */

const STORAGE_KEYS = {
  localRecipes: "einkaufsplaner.localRecipes.v1",  // nur lokale user-rezepte
  shopping: "einkaufsplaner.shopping.v2",
  openTabs: "einkaufsplaner.openTabs.v2",
  tabState: "einkaufsplaner.tabState.v2",
};

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element id="${id}" (index.html ↔ app.js mismatch)`);
  return el;
};

function showError(err) {
  const banner = $("errorBanner");
  banner.hidden = false;
  banner.textContent =
    `⚠️ Fehler: ${err?.message ?? err}\n\n` +
    `Tipp: Prüfe data/recipes.json und/oder klicke "Reset lokal".`;
  console.error(err);
}

window.addEventListener("error", (e) => showError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showError(e.reason || "Unhandled Promise Rejection"));

function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (Number.isNaN(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function roundAmount(x) {
  const eps = 1e-9;
  if (Math.abs(x - Math.round(x)) < eps) return String(Math.round(x));
  const one = Math.round(x * 10) / 10;
  if (Math.abs(x - one) < 0.0001) return String(one);
  const two = Math.round(x * 100) / 100;
  return String(two);
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ----------------- Data loading -----------------
async function loadBaseRecipesFromFile() {
  const res = await fetch("data/recipes.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Konnte data/recipes.json nicht laden (HTTP ${res.status}).`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("data/recipes.json muss ein Array sein.");

  return data.map(normalizeRecipeFromJson);
}

function normalizeRecipeFromJson(r) {
  const recipeId = uid();
  return {
    id: recipeId,
    source: "base",
    name: String(r.name ?? "Unbenannt"),
    baseServings: clampInt(r.baseServings ?? 2, 1, 200),
    timeMinutes: clampInt(r.timeMinutes ?? 0, 0, 2000),
    instructions: String(r.instructions ?? ""),
    rating: undefined, // Bewertung ist bewusst lokal
    ingredients: Array.isArray(r.ingredients)
      ? r.ingredients.map((i) => ({
          id: uid(),
          name: String(i.name ?? "").trim(),
          amount: Number(i.amount ?? 0),
          unit: String(i.unit ?? "").trim(),
        })).filter(i => i.name && Number.isFinite(i.amount) && i.unit)
      : [],
  };
}

function normalizeLocalRecipe(r) {
  // local recipes already have ids, but ensure shape
  return {
    id: String(r.id ?? uid()),
    source: "local",
    name: String(r.name ?? "Unbenannt"),
    baseServings: clampInt(r.baseServings ?? 2, 1, 200),
    timeMinutes: clampInt(r.timeMinutes ?? 0, 0, 2000),
    instructions: String(r.instructions ?? ""),
    rating: r.rating ? clampInt(r.rating, 1, 5) : undefined,
    ingredients: Array.isArray(r.ingredients)
      ? r.ingredients.map((i) => ({
          id: String(i.id ?? uid()),
          name: String(i.name ?? "").trim(),
          amount: Number(i.amount ?? 0),
          unit: String(i.unit ?? "").trim(),
        })).filter(i => i.name && Number.isFinite(i.amount) && i.unit)
      : [],
  };
}

function mergeRecipes(baseRecipes, localRecipes) {
  // merge by name (case-insensitive). local overrides base with same name.
  const map = new Map();
  for (const r of baseRecipes) map.set(r.name.trim().toLowerCase(), r);
  for (const r of localRecipes) map.set(r.name.trim().toLowerCase(), r);
  return Array.from(map.values());
}

// ----------------- State -----------------
let recipes = []; // merged recipes (base + local)
let localRecipes = loadJSON(STORAGE_KEYS.localRecipes, []);
if (!Array.isArray(localRecipes)) localRecipes = [];

let shoppingList = loadJSON(STORAGE_KEYS.shopping, []);
if (!Array.isArray(shoppingList)) shoppingList = [];

let openTabs = loadJSON(STORAGE_KEYS.openTabs, []);
if (!Array.isArray(openTabs)) openTabs = [];

let tabState = loadJSON(STORAGE_KEYS.tabState, {});
if (typeof tabState !== "object" || tabState === null) tabState = {};

let activeTabId = openTabs[0] ?? null;

// ----------------- DOM -----------------
const recipeListEl = $("recipeList");
const emptyRecipesEl = $("emptyRecipes");
const recipeSearchEl = $("recipeSearch");

const tabsBarEl = $("tabsBar");
const tabsEmptyEl = $("tabsEmpty");

const detailEl = $("recipeDetail");
const detailTitleEl = $("detailTitle");
const detailMetaEl = $("detailMeta");
const servingsInputEl = $("servingsInput");
const ratingSelectEl = $("ratingSelect");
const ingredientsListEl = $("ingredientsList");
const instructionsEl = $("instructions");
const btnAddToShoppingEl = $("btnAddToShopping");
const btnDeleteRecipeEl = $("btnDeleteRecipe");

const shoppingListEl = $("shoppingList");
const emptyShoppingEl = $("emptyShopping");

const btnClearShoppingEl = $("btnClearShopping");
const btnExportEl = $("btnExport");
const btnResetLocalEl = $("btnResetLocal");

const btnOpenAddModalEl = $("btnOpenAddModal");
const btnCloseAddModalEl = $("btnCloseAddModal");
const modalBackdropEl = $("modalBackdrop");
const addModalEl = $("addModal");

const newNameEl = $("newName");
const newBaseServingsEl = $("newBaseServings");
const newTimeEl = $("newTime");
const newInstructionsEl = $("newInstructions");
const ingredientRowsEl = $("ingredientRows");
const btnAddIngredientRowEl = $("btnAddIngredientRow");
const btnCreateRecipeEl = $("btnCreateRecipe");

// ----------------- Persist -----------------
function persistLocalRecipes() { saveJSON(STORAGE_KEYS.localRecipes, localRecipes); }
function persistTabs() { saveJSON(STORAGE_KEYS.openTabs, openTabs); }
function persistShopping() { saveJSON(STORAGE_KEYS.shopping, shoppingList); }
function persistTabState() { saveJSON(STORAGE_KEYS.tabState, tabState); }

// ----------------- Rendering -----------------
function renderAll() {
  renderRecipeList();
  renderTabs();
  renderDetail();
  renderShoppingList();
}

function renderRecipeList() {
  const q = (recipeSearchEl.value ?? "").trim().toLowerCase();
  const filtered = recipes
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((r) => (q ? r.name.toLowerCase().includes(q) : true));

  recipeListEl.innerHTML = "";
  emptyRecipesEl.hidden = filtered.length !== 0;

  for (const recipe of filtered) {
    const li = document.createElement("li");
    li.className = "listItem";
    li.tabIndex = 0;

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.gap = "6px";

    const title = document.createElement("div");
    title.className = "listItem__title";
    title.textContent = recipe.name;

    const meta = document.createElement("div");
    meta.className = "muted small";
    const src = recipe.source === "local" ? "• lokal" : "• json";
    meta.textContent =
      `${recipe.timeMinutes ?? 0} min • Basis: ${recipe.baseServings} Portion(en) ${src}` +
      (recipe.rating ? ` • Deine Bewertung: ${recipe.rating}/5` : "");

    left.appendChild(title);
    left.appendChild(meta);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Öffnen";

    li.appendChild(left);
    li.appendChild(badge);

    li.addEventListener("click", () => openRecipeTab(recipe.id));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") openRecipeTab(recipe.id);
    });

    recipeListEl.appendChild(li);
  }
}

function renderTabs() {
  tabsBarEl.innerHTML = "";

  if (openTabs.length === 0) {
    tabsEmptyEl.style.display = "block";
    detailEl.hidden = true;
    return;
  }
  tabsEmptyEl.style.display = "none";

  for (const rid of openTabs) {
    const recipe = recipes.find((r) => r.id === rid);
    if (!recipe) continue;

    const tab = document.createElement("div");
    tab.className = "tab" + (rid === activeTabId ? " tab--active" : "");
    tab.title = recipe.name;

    const name = document.createElement("span");
    name.textContent = recipe.name;

    const close = document.createElement("button");
    close.className = "tab__close";
    close.textContent = "✕";
    close.title = "Tab schließen";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(rid);
    });

    tab.appendChild(name);
    tab.appendChild(close);

    tab.addEventListener("click", () => {
      activeTabId = rid;
      persistTabs();
      renderTabs();
      renderDetail();
    });

    tabsBarEl.appendChild(tab);
  }
}

function renderDetail() {
  if (!activeTabId) {
    detailEl.hidden = true;
    return;
  }

  const recipe = recipes.find((r) => r.id === activeTabId);
  if (!recipe) {
    detailEl.hidden = true;
    return;
  }

  detailEl.hidden = false;
  detailTitleEl.textContent = recipe.name;

  const src = recipe.source === "local" ? "lokal" : "json";
  detailMetaEl.textContent = `${recipe.timeMinutes ?? 0} min • Basis: ${recipe.baseServings} Portion(en) • Quelle: ${src}`;

  const defaultServings = recipe.baseServings;
  const savedServings = tabState?.[recipe.id]?.servings ?? defaultServings;
  servingsInputEl.value = String(clampInt(savedServings, 1, 200));

  ratingSelectEl.value = recipe.rating ? String(recipe.rating) : "";
  instructionsEl.textContent = recipe.instructions ?? "";

  renderScaledIngredients(recipe);

  servingsInputEl.oninput = () => {
    const newServings = clampInt(servingsInputEl.value, 1, 200);
    servingsInputEl.value = String(newServings);
    tabState[recipe.id] = { ...(tabState[recipe.id] ?? {}), servings: newServings };
    persistTabState();
    renderScaledIngredients(recipe);
  };

  ratingSelectEl.onchange = () => {
    const val = ratingSelectEl.value;
    recipe.rating = val ? clampInt(val, 1, 5) : undefined;

    // rating immer lokal persistieren:
    // - wenn recipe json: wir speichern rating im tabState (nicht im json)
    // - wenn recipe local: wir schreiben rating ins localRecipe-Objekt
    if (recipe.source === "local") {
      const idx = localRecipes.findIndex((r) => r.id === recipe.id);
      if (idx >= 0) {
        localRecipes[idx].rating = recipe.rating;
        persistLocalRecipes();
      }
    } else {
      tabState[recipe.id] = tabState[recipe.id] ?? {};
      tabState[recipe.id].rating = recipe.rating;
      persistTabState();
    }

    renderRecipeList();
  };

  btnAddToShoppingEl.onclick = () => {
    const servings = clampInt(servingsInputEl.value, 1, 200);
    addRecipeToShopping(recipe, servings);
  };

  // löschen nur für lokale Rezepte sinnvoll
  btnDeleteRecipeEl.disabled = recipe.source !== "local";
  btnDeleteRecipeEl.onclick = () => {
    if (recipe.source !== "local") {
      alert("Dieses Rezept kommt aus recipes.json und kann hier nicht gelöscht werden.\nBearbeite dafür data/recipes.json im Repo.");
      return;
    }
    deleteLocalRecipe(recipe.id);
  };
}

function getEffectiveRating(recipe) {
  if (recipe.source === "local") return recipe.rating;
  return tabState?.[recipe.id]?.rating ?? recipe.rating;
}

function renderScaledIngredients(recipe) {
  const servings = clampInt(servingsInputEl.value, 1, 200);
  const factor = servings / recipe.baseServings;

  tabState[recipe.id] = tabState[recipe.id] ?? {};
  tabState[recipe.id].selectedIngredients = tabState[recipe.id].selectedIngredients ?? {};
  const selectedMap = tabState[recipe.id].selectedIngredients;

  ingredientsListEl.innerHTML = "";

  for (const ing of recipe.ingredients ?? []) {
    if (selectedMap[ing.id] === undefined) selectedMap[ing.id] = true;

    const li = document.createElement("li");
    li.className = "listItem";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "ingRow__check";
    check.checked = Boolean(selectedMap[ing.id]);
    check.addEventListener("change", () => {
      selectedMap[ing.id] = check.checked;
      persistTabState();
    });

    const name = document.createElement("div");
    name.className = "ingRow__name";
    name.textContent = ing.name;

    const leftWrap = document.createElement("div");
    leftWrap.className = "ingRow";
    leftWrap.appendChild(check);
    leftWrap.appendChild(name);

    const scaled = (Number(ing.amount) || 0) * factor;
    const amountBadge = document.createElement("div");
    amountBadge.className = "badge";
    amountBadge.textContent = `${roundAmount(scaled)} ${ing.unit}`;

    const rightWrap = document.createElement("div");
    rightWrap.className = "ingRow__right";
    rightWrap.appendChild(amountBadge);

    li.appendChild(leftWrap);
    li.appendChild(rightWrap);

    ingredientsListEl.appendChild(li);
  }

  persistTabState();
}

function renderShoppingList() {
  shoppingListEl.innerHTML = "";

  if (shoppingList.length === 0) {
    emptyShoppingEl.hidden = false;
    return;
  }
  emptyShoppingEl.hidden = true;

  const items = shoppingList
    .slice()
    .sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name));

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "shoppingRow";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "checkbox";
    cb.checked = Boolean(item.checked);
    cb.addEventListener("change", () => {
      item.checked = cb.checked;
      persistShopping();
      renderShoppingList();
    });

    const name = document.createElement("div");
    name.className = "shoppingRow__name";
    name.textContent = `${item.name} (${item.unit})`;

    const amount = document.createElement("div");
    amount.className = "badge";
    amount.textContent = roundAmount(item.amount);

    li.appendChild(cb);
    li.appendChild(name);
    li.appendChild(amount);

    shoppingListEl.appendChild(li);
  }
}

// ----------------- Actions -----------------
function openRecipeTab(recipeId) {
  if (!openTabs.includes(recipeId)) openTabs.push(recipeId);
  activeTabId = recipeId;
  persistTabs();
  renderTabs();
  renderDetail();
}

function closeTab(recipeId) {
  openTabs = openTabs.filter((id) => id !== recipeId);
  if (activeTabId === recipeId) activeTabId = openTabs[openTabs.length - 1] ?? null;
  persistTabs();
  renderTabs();
  renderDetail();
}

function addRecipeToShopping(recipe, servings) {
  const factor = servings / recipe.baseServings;

  const selectedMap = tabState?.[recipe.id]?.selectedIngredients ?? {};
  let addedCount = 0;

  for (const ing of recipe.ingredients ?? []) {
    const isSelected = selectedMap[ing.id] !== false;
    if (!isSelected) continue;

    const scaledAmount = (Number(ing.amount) || 0) * factor;

    const keyName = (ing.name ?? "").trim().toLowerCase();
    const keyUnit = (ing.unit ?? "").trim().toLowerCase();

    const existing = shoppingList.find(
      (s) => s.name.trim().toLowerCase() === keyName && s.unit.trim().toLowerCase() === keyUnit
    );

    if (existing) existing.amount += scaledAmount;
    else {
      shoppingList.push({
        id: uid(),
        name: ing.name.trim(),
        unit: ing.unit.trim(),
        amount: scaledAmount,
        checked: false,
      });
    }

    addedCount++;
  }

  persistShopping();
  renderShoppingList();

  if (addedCount === 0) alert("Keine Zutaten ausgewählt. Bitte Häkchen setzen, was auf die Einkaufsliste soll.");
}

function deleteLocalRecipe(recipeId) {
  const recipe = recipes.find(r => r.id === recipeId);
  if (!recipe) return;

  const ok = confirm(`Rezept wirklich löschen?\n\n${recipe.name}`);
  if (!ok) return;

  localRecipes = localRecipes.filter((r) => r.id !== recipeId);
  persistLocalRecipes();

  // tabs + state bereinigen
  openTabs = openTabs.filter((id) => id !== recipeId);
  if (activeTabId === recipeId) activeTabId = openTabs[0] ?? null;
  persistTabs();

  delete tabState[recipeId];
  persistTabState();

  // neu mergen und rendern
  recipes = mergeRecipes(baseRecipesCache, localRecipes.map(normalizeLocalRecipe));
  renderAll();
}

// ----------------- Modal (lokale Rezepte) -----------------
function openAddModal() {
  modalBackdropEl.hidden = false;
  addModalEl.hidden = false;

  newNameEl.value = "";
  newBaseServingsEl.value = "2";
  newTimeEl.value = "30";
  newInstructionsEl.value = "";
  ingredientRowsEl.innerHTML = "";

  addIngredientRow("", "", "");
  addIngredientRow("", "", "");
  addIngredientRow("", "", "");

  newNameEl.focus();
}

function closeAddModal() {
  modalBackdropEl.hidden = true;
  addModalEl.hidden = true;
}

function addIngredientRow(name = "", amount = "", unit = "") {
  const row = document.createElement("div");
  row.className = "row";

  const inName = document.createElement("input");
  inName.className = "input";
  inName.placeholder = "Zutat (z. B. Kichererbsen)";
  inName.value = String(name);

  const inAmount = document.createElement("input");
  inAmount.className = "input";
  inAmount.placeholder = "Menge";
  inAmount.type = "number";
  inAmount.step = "0.01";
  inAmount.value = String(amount);

  const inUnit = document.createElement("input");
  inUnit.className = "input";
  inUnit.placeholder = "Einheit (g/ml/pcs/EL …)";
  inUnit.value = String(unit);

  const btnDel = document.createElement("button");
  btnDel.className = "btn btn--danger btn--ghost";
  btnDel.textContent = "Entfernen";
  btnDel.addEventListener("click", () => row.remove());

  row.appendChild(inName);
  row.appendChild(inAmount);
  row.appendChild(inUnit);
  row.appendChild(btnDel);

  ingredientRowsEl.appendChild(row);
}

function collectIngredientRows() {
  const rows = Array.from(ingredientRowsEl.querySelectorAll(".row"));
  const ingredients = [];

  for (const row of rows) {
    const inputs = row.querySelectorAll("input");
    const name = (inputs[0]?.value ?? "").trim();
    const amountRaw = inputs[1]?.value ?? "";
    const unit = (inputs[2]?.value ?? "").trim();

    if (!name) continue;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) continue;
    if (!unit) continue;

    ingredients.push({ id: uid(), name, amount, unit });
  }
  return ingredients;
}

function createLocalRecipeFromModal() {
  const name = (newNameEl.value ?? "").trim();
  const baseServings = clampInt(newBaseServingsEl.value, 1, 200);
  const timeMinutes = clampInt(newTimeEl.value, 0, 2000);
  const instructions = (newInstructionsEl.value ?? "").trim();
  const ingredients = collectIngredientRows();

  if (!name) return alert("Bitte einen Rezeptnamen eingeben.");
  if (ingredients.length === 0) return alert("Bitte mindestens eine gültige Zutat (Name, Menge, Einheit) eingeben.");

  const recipe = {
    id: uid(),
    source: "local",
    name,
    baseServings,
    timeMinutes,
    instructions,
    ingredients,
    rating: undefined,
  };

  localRecipes.push(recipe);
  persistLocalRecipes();

  // neu mergen
  recipes = mergeRecipes(baseRecipesCache, localRecipes.map(normalizeLocalRecipe));

  closeAddModal();
  renderRecipeList();

  // tab öffnen
  openRecipeTab(recipe.id);
}

// ----------------- Export / Reset -----------------
function shoppingAsText() {
  const items = shoppingList
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => `- ${roundAmount(i.amount)} ${i.unit} ${i.name}${i.checked ? " ✅" : ""}`)
    .join("\n");
  return `Einkaufsliste\n\n${items}\n`;
}

async function copyShoppingList() {
  if (shoppingList.length === 0) return alert("Die Einkaufsliste ist leer.");
  const text = shoppingAsText();
  try {
    await navigator.clipboard.writeText(text);
    alert("Einkaufsliste wurde kopiert.");
  } catch {
    prompt("Kopiere den Text:", text);
  }
}

function resetLocalData() {
  const ok = confirm(
    "Reset lokal löscht:\n" +
    "- lokale Rezepte\n" +
    "- Einkaufsliste\n" +
    "- Tabs + Tab-State\n\n" +
    "JSON-Rezepte aus data/recipes.json bleiben erhalten.\n\n" +
    "Fortfahren?"
  );
  if (!ok) return;

  localStorage.removeItem(STORAGE_KEYS.localRecipes);
  localStorage.removeItem(STORAGE_KEYS.shopping);
  localStorage.removeItem(STORAGE_KEYS.openTabs);
  localStorage.removeItem(STORAGE_KEYS.tabState);

  location.reload();
}

// ----------------- Wiring -----------------
recipeSearchEl.addEventListener("input", renderRecipeList);

btnOpenAddModalEl.addEventListener("click", openAddModal);
btnCloseAddModalEl.addEventListener("click", closeAddModal);
modalBackdropEl.addEventListener("click", closeAddModal);

btnAddIngredientRowEl.addEventListener("click", () => addIngredientRow());
btnCreateRecipeEl.addEventListener("click", createLocalRecipeFromModal);

btnClearShoppingEl.addEventListener("click", () => {
  if (shoppingList.length === 0) return;
  if (!confirm("Einkaufsliste wirklich leeren?")) return;
  shoppingList = [];
  persistShopping();
  renderShoppingList();
});

btnExportEl.addEventListener("click", copyShoppingList);
btnResetLocalEl.addEventListener("click", resetLocalData);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !addModalEl.hidden) closeAddModal();
});

// ----------------- Init -----------------
let baseRecipesCache = [];

(async function init() {
  try {
    baseRecipesCache = await loadBaseRecipesFromFile();

    // bring ratings for base recipes from tabState if present
    // (we keep rating local-only)
    const normalizedLocal = localRecipes.map(normalizeLocalRecipe);
    recipes = mergeRecipes(baseRecipesCache, normalizedLocal);

    // apply effective ratings into recipes for rendering convenience
    for (const r of recipes) {
      r.rating = getEffectiveRating(r);
    }

    // sanitize tabs
    openTabs = openTabs.filter((rid) => recipes.some((r) => r.id === rid));
    if (openTabs.length === 0) activeTabId = null;
    else if (!openTabs.includes(activeTabId)) activeTabId = openTabs[0];

    persistTabs();
    renderAll();
  } catch (err) {
    showError(err);
  }
})();
