"use strict";

/**
 * Data shapes:
 * Recipe {
 *   id: string,
 *   name: string,
 *   baseServings: number,
 *   timeMinutes: number,
 *   instructions: string,
 *   ingredients: [{ id, name, amount, unit }]
 *   rating?: number (1..5)
 * }
 *
 * ShoppingItem {
 *   id: string,
 *   name: string,
 *   amount: number,
 *   unit: string,
 *   checked: boolean
 * }
 */

const STORAGE_KEYS = {
  recipes: "einkaufsplaner.recipes.v1",
  shopping: "einkaufsplaner.shopping.v1",
  openTabs: "einkaufsplaner.openTabs.v1", // array of recipe ids
  tabState: "einkaufsplaner.tabState.v1", // map: recipeId -> { servings }
};

const $ = (id) => document.getElementById(id);

function uid() {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
}

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (Number.isNaN(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function roundAmount(x) {
  // Nicely display amounts without ugly floating noise:
  // - integers as-is
  // - else 1 decimal if needed, else 2 decimals max
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

// ---------- State ----------
let recipes = loadJSON(STORAGE_KEYS.recipes, null);
let shoppingList = loadJSON(STORAGE_KEYS.shopping, null);
let openTabs = loadJSON(STORAGE_KEYS.openTabs, []);
let tabState = loadJSON(STORAGE_KEYS.tabState, {});

if (!Array.isArray(recipes) || recipes.length === 0) {
  recipes = seedRecipes();
  saveJSON(STORAGE_KEYS.recipes, recipes);
}
if (!Array.isArray(shoppingList)) {
  shoppingList = [];
  saveJSON(STORAGE_KEYS.shopping, shoppingList);
}
if (!Array.isArray(openTabs)) openTabs = [];
if (typeof tabState !== "object" || tabState === null) tabState = {};

let activeTabId = openTabs[0] ?? null;

// ---------- Seed ----------
function seedRecipes() {
  return [
    {
      id: uid(),
      name: "Pasta Tomate",
      baseServings: 2,
      timeMinutes: 20,
      instructions: "1) Nudeln kochen.\n2) Tomaten + Knoblauch anbraten.\n3) Alles mischen und abschmecken.",
      rating: 3,
      ingredients: [
        { id: uid(), name: "Nudeln", amount: 200, unit: "g" },
        { id: uid(), name: "Tomaten", amount: 2, unit: "pcs" },
        { id: uid(), name: "Knoblauchzehe", amount: 1, unit: "pcs" },
        { id: uid(), name: "Olivenöl", amount: 2, unit: "EL" },
      ],
    },
    {
      id: uid(),
      name: "Haferflocken Bowl",
      baseServings: 1,
      timeMinutes: 5,
      instructions: "Alles in eine Schüssel. Optional mit Obst/Nüssen toppen.",
      rating: 4,
      ingredients: [
        { id: uid(), name: "Haferflocken", amount: 80, unit: "g" },
        { id: uid(), name: "Milch", amount: 250, unit: "ml" },
        { id: uid(), name: "Banane", amount: 1, unit: "pcs" },
      ],
    },
  ];
}

// ---------- DOM refs ----------
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

// ---------- Rendering ----------
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
  if (filtered.length === 0) {
    emptyRecipesEl.hidden = recipes.length !== 0; // show only if really empty
  } else {
    emptyRecipesEl.hidden = true;
  }

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
    meta.textContent =
      `${recipe.timeMinutes ?? 0} min • Basis: ${recipe.baseServings} Portion(en)` +
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
  detailMetaEl.textContent = `${recipe.timeMinutes ?? 0} min • Basis: ${recipe.baseServings} Portion(en)`;

  // servings state per tab
  const defaultServings = recipe.baseServings;
  const savedServings = tabState?.[recipe.id]?.servings ?? defaultServings;
  servingsInputEl.value = String(clampInt(savedServings, 1, 200));

  // rating
  ratingSelectEl.value = recipe.rating ? String(recipe.rating) : "";

  // instructions
  instructionsEl.textContent = recipe.instructions ?? "";

  // ingredients (scaled)
  renderScaledIngredients(recipe);

  // handlers (re-bind safe)
  servingsInputEl.oninput = () => {
    const newServings = clampInt(servingsInputEl.value, 1, 200);
    servingsInputEl.value = String(newServings);
    tabState[recipe.id] = { ...(tabState[recipe.id] ?? {}), servings: newServings };
    saveJSON(STORAGE_KEYS.tabState, tabState);
    renderScaledIngredients(recipe);
  };

  ratingSelectEl.onchange = () => {
    const val = ratingSelectEl.value;
    recipe.rating = val ? clampInt(val, 1, 5) : undefined;
    persistRecipes();
    renderRecipeList(); // update meta
  };

  btnAddToShoppingEl.onclick = () => {
    const servings = clampInt(servingsInputEl.value, 1, 200);
    addRecipeToShopping(recipe, servings);
  };

  btnDeleteRecipeEl.onclick = () => {
    deleteRecipe(recipe.id);
  };
}

function renderScaledIngredients(recipe) {
  const servings = clampInt(servingsInputEl.value, 1, 200);
  const factor = servings / recipe.baseServings;

  ingredientsListEl.innerHTML = "";
  for (const ing of recipe.ingredients ?? []) {
    const li = document.createElement("li");
    li.className = "listItem";

    const left = document.createElement("div");
    left.textContent = ing.name;

    const right = document.createElement("div");
    right.className = "badge";
    const scaled = (Number(ing.amount) || 0) * factor;
    right.textContent = `${roundAmount(scaled)} ${ing.unit}`;

    li.appendChild(left);
    li.appendChild(right);
    ingredientsListEl.appendChild(li);
  }
}

function renderShoppingList() {
  shoppingListEl.innerHTML = "";

  if (shoppingList.length === 0) {
    emptyShoppingEl.hidden = false;
    return;
  }
  emptyShoppingEl.hidden = true;

  // sort: unchecked first, then alpha
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

// ---------- Actions ----------
function openRecipeTab(recipeId) {
  if (!openTabs.includes(recipeId)) openTabs.push(recipeId);
  activeTabId = recipeId;
  persistTabs();
  renderTabs();
  renderDetail();
}

function closeTab(recipeId) {
  openTabs = openTabs.filter((id) => id !== recipeId);
  if (activeTabId === recipeId) {
    activeTabId = openTabs[openTabs.length - 1] ?? null;
  }
  persistTabs();
  renderTabs();
  renderDetail();
}

function persistTabs() {
  saveJSON(STORAGE_KEYS.openTabs, openTabs);
}

function persistRecipes() {
  saveJSON(STORAGE_KEYS.recipes, recipes);
}

function persistShopping() {
  saveJSON(STORAGE_KEYS.shopping, shoppingList);
}

function addRecipeToShopping(recipe, servings) {
  const factor = servings / recipe.baseServings;

  for (const ing of recipe.ingredients ?? []) {
    const scaledAmount = (Number(ing.amount) || 0) * factor;

    // merge by name+unit (simple & robust)
    const keyName = (ing.name ?? "").trim().toLowerCase();
    const keyUnit = (ing.unit ?? "").trim().toLowerCase();

    const existing = shoppingList.find(
      (s) => s.name.trim().toLowerCase() === keyName && s.unit.trim().toLowerCase() === keyUnit
    );

    if (existing) {
      existing.amount += scaledAmount;
    } else {
      shoppingList.push({
        id: uid(),
        name: ing.name.trim(),
        unit: ing.unit.trim(),
        amount: scaledAmount,
        checked: false,
      });
    }
  }

  persistShopping();
  renderShoppingList();
}

function deleteRecipe(recipeId) {
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return;

  const ok = confirm(`Rezept wirklich löschen?\n\n${recipe.name}`);
  if (!ok) return;

  recipes = recipes.filter((r) => r.id !== recipeId);
  persistRecipes();

  // close tab if open
  openTabs = openTabs.filter((id) => id !== recipeId);
  if (activeTabId === recipeId) activeTabId = openTabs[0] ?? null;
  persistTabs();

  // remove tabState
  delete tabState[recipeId];
  saveJSON(STORAGE_KEYS.tabState, tabState);

  renderAll();
}

// ---------- Modal: Add Recipe ----------
function openAddModal() {
  modalBackdropEl.hidden = false;
  addModalEl.hidden = false;

  // reset
  newNameEl.value = "";
  newBaseServingsEl.value = "2";
  newTimeEl.value = "20";
  newInstructionsEl.value = "";
  ingredientRowsEl.innerHTML = "";

  // 3 rows default
  addIngredientRow("Nudeln", 200, "g");
  addIngredientRow("Tomaten", 2, "pcs");
  addIngredientRow("Olivenöl", 2, "EL");

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
  inName.placeholder = "Zutat (z. B. Milch)";
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

function createRecipeFromModal() {
  const name = (newNameEl.value ?? "").trim();
  const baseServings = clampInt(newBaseServingsEl.value, 1, 200);
  const timeMinutes = clampInt(newTimeEl.value, 0, 2000);
  const instructions = (newInstructionsEl.value ?? "").trim();
  const ingredients = collectIngredientRows();

  if (!name) {
    alert("Bitte einen Rezeptnamen eingeben.");
    return;
  }
  if (ingredients.length === 0) {
    alert("Bitte mindestens eine gültige Zutat eingeben (Name, Menge, Einheit).");
    return;
  }

  const recipe = {
    id: uid(),
    name,
    baseServings,
    timeMinutes,
    instructions,
    ingredients,
    rating: undefined,
  };

  recipes.push(recipe);
  persistRecipes();

  closeAddModal();
  renderRecipeList();
  openRecipeTab(recipe.id);
}

// ---------- Export ----------
function shoppingAsText() {
  const items = shoppingList
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => `- ${roundAmount(i.amount)} ${i.unit} ${i.name}${i.checked ? " ✅" : ""}`)
    .join("\n");

  return `Einkaufsliste\n\n${items}\n`;
}

async function copyShoppingList() {
  if (shoppingList.length === 0) {
    alert("Die Einkaufsliste ist leer.");
    return;
  }
  const text = shoppingAsText();
  try {
    await navigator.clipboard.writeText(text);
    alert("Einkaufsliste wurde in die Zwischenablage kopiert.");
  } catch {
    // fallback
    prompt("Kopiere den Text:", text);
  }
}

// ---------- Wire up ----------
recipeSearchEl.addEventListener("input", renderRecipeList);

btnOpenAddModalEl.addEventListener("click", openAddModal);
btnCloseAddModalEl.addEventListener("click", closeAddModal);
modalBackdropEl.addEventListener("click", closeAddModal);

btnAddIngredientRowEl.addEventListener("click", () => addIngredientRow());
btnCreateRecipeEl.addEventListener("click", createRecipeFromModal);

btnClearShoppingEl.addEventListener("click", () => {
  if (shoppingList.length === 0) return;
  const ok = confirm("Einkaufsliste wirklich leeren?");
  if (!ok) return;
  shoppingList = [];
  persistShopping();
  renderShoppingList();
});

btnExportEl.addEventListener("click", copyShoppingList);

// Close modal on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !addModalEl.hidden) closeAddModal();
});

// ---------- Init ----------
(function init() {
  // Ensure tabs contain only existing recipes (after deletes)
  openTabs = openTabs.filter((rid) => recipes.some((r) => r.id === rid));
  if (openTabs.length === 0) activeTabId = null;
  else if (!openTabs.includes(activeTabId)) activeTabId = openTabs[0];

  persistTabs();
  renderAll();
})();
