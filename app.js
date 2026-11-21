"use strict";

const $ = id => document.getElementById(id);
const bookName = "our-family-table";
const defaultCategories = ["Appetizers", "Breads", "Desserts", "Main Dishes", "Salads", "Side Dishes", "Soups"];
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
let state = { book: Cookbook.empty(), dirty: false };
let selectedId = null;
let formChanged = false;
let busy = true;
let database;
let localProblem = "";
let localToken;
let pendingWrite = Promise.resolve();

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function button(label, handler, primary = false) {
  const node = element("button", label, primary ? "primary" : "");
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}

function updateStatus() {
  const status = $("status");
  status.textContent = [
    formChanged ? "Unsaved recipe edits. Select Save Recipe before exporting." :
      state.dirty ? "Unexported cookbook changes. Select Save & Export, then put the file in Dropbox." :
        "Cookbook files stay on this device until you upload them to Dropbox.",
    localProblem
  ].filter(Boolean).join(" ");
  status.dataset.warning = String(Boolean(formChanged || state.dirty || localProblem));
  window.removeEventListener("beforeunload", warnOnExit);
  if (formChanged || state.dirty) window.addEventListener("beforeunload", warnOnExit);
}

function warnOnExit(event) {
  event.preventDefault();
  event.returnValue = true;
}

function persist() {
  const snapshot = state;
  updateStatus();
  if (!database) return;
  pendingWrite = pendingWrite.then(() => new Promise((resolve, reject) => {
    if (!database) return resolve();
    const transaction = database.transaction("working", "readwrite");
    const store = transaction.objectStore("working");
    const current = store.get("copy");
    const nextToken = Cookbook.id();
    current.onsuccess = () => {
      if (current.result?.token !== localToken) transaction.abort();
      else store.put({ ...snapshot, token: nextToken }, "copy");
    };
    transaction.oncomplete = () => {
      localToken = nextToken;
      resolve();
    };
    transaction.onabort = () => reject(transaction.error);
  })).catch(() => {
    database.close();
    database = undefined;
    localProblem = "This tab could not save its working copy. Export it before leaving. Another tab may have saved a newer copy.";
    updateStatus();
  });
}

function setBook(book, dirty) {
  state = { book, dirty };
  persist();
}

function sortedRecipes() {
  return [...state.book.recipes].sort((a, b) => collator.compare(a.title, b.title));
}

function renderList() {
  const filter = $("category");
  const selected = filter.value;
  const categories = [...new Set(state.book.recipes.map(recipe => recipe.category).filter(Boolean))].sort(collator.compare);
  filter.replaceChildren(new Option("All categories", ""), ...categories.map(name => new Option(name, name)));
  if (categories.includes(selected)) filter.value = selected;
  const terms = normalize($("search").value).trim().split(/\s+/);
  const visible = sortedRecipes().filter(recipe => {
    const searchable = normalize([recipe.title, recipe.category, ...recipe.ingredients, ...recipe.directions].join(" "));
    return (!filter.value || recipe.category === filter.value) && terms.every(term => searchable.includes(term));
  });
  $("count").textContent = `${visible.length} of ${state.book.recipes.length} recipes`;
  $("recipes").replaceChildren(...visible.map(recipe => {
    const li = element("li");
    const item = button(recipe.title, () => {
      if (allowDiscard()) showRecipe(recipe.id);
    });
    if (recipe.id === selectedId) item.setAttribute("aria-current", "true");
    li.append(item);
    return li;
  }));
}

function normalize(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function allowDiscard() {
  return !busy && (!formChanged || confirm("Discard the unsaved edits in this recipe form?"));
}

function panel(focus) {
  formChanged = false;
  updateStatus();
  const detail = $("detail");
  detail.replaceChildren();
  const back = button("Back to recipes", () => {
    if (!allowDiscard()) return;
    showRecipe(null);
    $("search").focus();
  });
  back.className = "mobile-back";
  detail.append(back);
  document.body.dataset.open = "true";
  if (focus) detail.focus();
  return detail;
}

function typedContent(recipe) {
  const article = element("article");
  article.append(element("p", recipe.category || "Uncategorized", "meta"), element("h1", recipe.title));
  if (recipe.review) article.append(element("p", "Transcription review · " + recipe.review, "review"));
  for (const [heading, tag, items] of [
    ["Ingredients", "ul", recipe.ingredients], ["Directions", "ol", recipe.directions]
  ]) {
    article.append(element("h2", heading));
    const list = element(tag);
    list.append(...items.map(item => element("li", item)));
    article.append(items.length ? list : element("p", "No transcription entered."));
  }
  if (recipe.notes) article.append(element("h2", "Family notes"), element("p", recipe.notes, "notes"));
  return article;
}

function scans(recipe) {
  const sources = new Map((state.book.sources || []).map(source => [source.id, source]));
  const pages = (recipe.sourceIds || []).map(id => sources.get(id));
  if (recipe.scanData) pages.unshift({ name: "Original scan", data: recipe.scanData });
  return pages;
}

function scanContent(pages) {
  const section = element("section");
  section.append(element("h2", "Original scanned pages"));
  pages.forEach((source, index) => {
    const figure = element("figure");
    const img = element("img", undefined, "scan");
    img.alt = `Original page ${index + 1}`;
    const caption = element("figcaption", source.name);
    img.addEventListener("error", () => caption.textContent = source.name + " · Preview unavailable. Download the original.");
    img.src = source.data;
    const link = element("a", "Download original");
    link.href = source.data;
    link.download = source.name;
    figure.append(img, caption, link);
    section.append(figure);
  });
  return section;
}

function showRecipe(id, focus = true) {
  selectedId = id;
  renderList();
  const recipe = state.book.recipes.find(item => item.id === id);
  if (!recipe) {
    formChanged = false;
    updateStatus();
    document.body.dataset.open = "false";
    $("detail").replaceChildren(element("h1", "Family cookbook"), element("p",
      state.book.recipes.length ? "Select a recipe from the list." : "Import the shared cookbook from Files or add your first recipe."));
    return;
  }
  const detail = panel(focus);
  const actions = element("div", undefined, "actions");
  const pages = scans(recipe);
  if (pages.length) actions.append(button(pages.length === 1 ? "View Original Scan" : "View Original Scans", event => {
    const existing = detail.querySelector("section");
    if (existing) existing.remove();
    else detail.append(scanContent(pages));
    event.currentTarget.setAttribute("aria-expanded", String(!existing));
    if (!existing) detail.lastChild.scrollIntoView({ block: "nearest" });
  }));
  if (pages.length) actions.firstChild.setAttribute("aria-expanded", "false");
  actions.append(button("Edit Recipe", () => { if (!busy) editRecipe(recipe); }, true),
    button("Print Recipe", () => printRecipes([recipe], false)),
    button("Revision History", () => showHistory(recipe)));
  detail.append(typedContent(recipe), actions);
}

function showHistory(recipe) {
  if (busy) return;
  const detail = panel(true);
  detail.append(element("h1", "Revision History"), element("p", recipe.title),
    button("Back to recipe", () => { if (!busy) showRecipe(recipe.id); }));
  const revisions = state.book.history.filter(entry => entry.recipeId === recipe.id).reverse();
  if (!revisions.length) detail.append(element("p", "No previous typed versions yet."));
  for (const revision of revisions) {
    const disclosure = element("details");
    disclosure.append(element("summary", new Date(revision.savedAt).toLocaleString()), typedContent(revision.previous),
      button("Restore this typed version", () => {
        if (busy || !confirm("Restore these typed values? Your current typed version will remain in Revision History.")) return;
        const updated = Cookbook.revise(state.book, recipe, revision.previous);
        if (updated !== state.book) setBook(updated, true);
        showRecipe(recipe.id);
        $("notice").textContent = "Typed version restored. Original scanned pages are preserved.";
      }));
    detail.append(disclosure);
  }
}

function editRecipe(existing) {
  const recipe = existing || { id: Cookbook.id(), title: "", category: "", ingredients: [], directions: [], notes: "", scanData: null };
  const detail = panel(true);
  detail.append(element("h1", existing ? "Edit recipe" : "Add recipe"));
  const form = element("form");
  detail.append(form);
  function field(label, value, multiline = false) {
    const heading = element("label", label);
    const input = element(multiline ? "textarea" : "input");
    input.value = value;
    heading.append(input);
    form.append(heading);
    return input;
  }
  const title = field("Recipe title", recipe.title);
  title.required = true;
  title.addEventListener("input", () => title.setCustomValidity(""));
  const category = field("Category", recipe.category);
  category.setAttribute("list", "category-options");
  const suggestions = element("datalist");
  suggestions.id = "category-options";
  suggestions.append(...[...new Set([...defaultCategories, ...state.book.recipes.map(item => item.category).filter(Boolean)])]
    .sort(collator.compare).map(name => new Option(name)));
  form.append(suggestions);
  const ingredients = field("Ingredients (one per line)", recipe.ingredients.join("\n"), true);
  const directions = field("Directions (one step per line)", recipe.directions.join("\n"), true);
  const notes = field("Family notes and memories", recipe.notes, true);
  const review = field("Transcription review (describe missing or uncertain text)", recipe.review || "", true);
  const scanLabel = element("label", "Attach additional original pages");
  const upload = element("input");
  upload.type = "file";
  upload.accept = "image/*";
  upload.multiple = true;
  scanLabel.append(upload);
  form.append(scanLabel);
  const known = state.book.sources || [];
  const linked = new Set(recipe.sourceIds || []);
  if (scans(recipe).length) form.append(element("p", `${scans(recipe).length} original page(s) already attached. Existing pages are preserved.`));
  if (known.some(source => !linked.has(source.id))) {
    const existingPages = element("details");
    existingPages.append(element("summary", "Link a page already in the cookbook"));
    for (const source of known.filter(item => !linked.has(item.id))) {
      const label = element("label");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.value = source.id;
      label.append(checkbox, document.createTextNode(" " + source.name));
      existingPages.append(label);
    }
    form.append(existingPages);
  }
  const error = element("p");
  error.setAttribute("role", "alert");
  const actions = element("div", undefined, "actions");
  const save = element("button", "Save Recipe", "primary");
  save.type = "submit";
  actions.append(save, button("Cancel", () => {
    if (allowDiscard()) showRecipe(existing?.id || null);
  }));
  form.append(error, actions);
  form.addEventListener("input", () => {
    formChanged = true;
    updateStatus();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    if (!title.value.trim()) {
      title.setCustomValidity("Enter a recipe title.");
      title.reportValidity();
      return;
    }
    busy = true;
    const textValue = (input, original) => input.value === original.replace(/\r\n?/g, "\n") ?
      original : input.value.trim();
    const lines = (input, original) => input.value === original.join("\n").replace(/\r\n?/g, "\n") ?
      original : input.value.split("\n").map(value => value.trim()).filter(Boolean);
    const values = { title: textValue(title, recipe.title), category: textValue(category, recipe.category),
      ingredients: lines(ingredients, recipe.ingredients), directions: lines(directions, recipe.directions),
      notes: textValue(notes, recipe.notes) };
    const reviewText = review.value.trim();
    const chosenPages = [...form.querySelectorAll("input[type=checkbox]:checked")].map(input => input.value);
    const sources = [...known];
    const sourceIds = new Set([...linked, ...chosenPages]);
    for (const control of form.elements) control.disabled = true;
    try {
      for (const file of upload.files) {
        const data = await readImage(file);
        if (!Cookbook.image(data)) throw Error("Choose a supported original image such as JPEG, PNG, WebP, TIFF or HEIC.");
        let source = sources.find(item => item.data === data);
        if (!source) {
          source = { id: Cookbook.id(), name: file.name, data };
          sources.push(source);
        }
        sourceIds.add(source.id);
      }
      const book = state.book;
      const updated = existing ? Cookbook.revise(book, recipe, values) :
        { ...book, recipes: [...book.recipes, { ...recipe, ...values }] };
      if (updated !== book || reviewText !== (recipe.review || "") || sourceIds.size !== linked.size) {
        setBook({ ...updated, sources, recipes: updated.recipes.map(item => item.id === recipe.id ?
          { ...item, review: reviewText, sourceIds: [...sourceIds] } : item) }, true);
      }
      showRecipe(recipe.id);
      $("notice").textContent = "Recipe saved. Use Save & Export to share changes through Dropbox.";
    } catch (problem) {
      error.textContent = problem.message || "The original image could not be read.";
    } finally {
      busy = false;
      for (const control of form.elements) control.disabled = false;
    }
  });
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("The original image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function importBook(file) {
  if (!file || busy) return;
  busy = true;
  try {
    const book = Cookbook.validate(JSON.parse(await file.text()));
    const message = state.dirty ? "Replace this working cookbook and its unexported changes? Cancel to export them first." :
      "Replace the current working cookbook with this file? Keep a dated copy of both files if they were edited separately.";
    if (formChanged && !confirm("Discard the unsaved edits in this recipe form?")) return;
    if ((state.dirty || state.book.recipes.length) && !confirm(message)) return;
    setBook(book, false);
    $("search").value = "";
    $("category").value = "";
    showRecipe(null);
    $("notice").textContent = `Imported ${book.recipes.length} recipes from ${file.name}.`;
  } catch (error) {
    $("notice").textContent = error instanceof SyntaxError ? "This file could not be read as JSON." :
      error.message || "The cookbook could not be opened.";
  } finally {
    busy = false;
  }
}

function exportBook() {
  if (busy || formChanged) {
    if (formChanged) $("notice").textContent = "Save or cancel the open recipe form before exporting.";
    return;
  }
  try {
    const book = { ...state.book, exportedAt: new Date().toISOString() };
    const file = new Blob([JSON.stringify(book, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = element("a");
    link.href = url;
    link.download = `${bookName}-${book.exportedAt.replace(/[:.]/g, "-")}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    // Browsers cannot confirm download completion. Keep the warning until the family verifies the file.
    const notice = $("notice");
    notice.replaceChildren(document.createTextNode("Export requested. Check that the dated file downloaded, then upload it to Dropbox. "));
    const sourceState = state;
    notice.append(button("I have the export", () => {
      if (state !== sourceState || formChanged) {
        notice.textContent = "The cookbook has changed since this export. Export the current copy.";
        return;
      }
      setBook(book, false);
      notice.textContent = "Export confirmed on this device. Share the dated file through Dropbox.";
    }));
  } catch {
    $("notice").textContent = "The export could not be created. Keep this tab open and try again.";
  }
}

async function printRecipes(recipes, includeScans) {
  if (busy || formChanged) return;
  if (!recipes.length) {
    $("notice").textContent = "Add or import recipes before printing.";
    return;
  }
  const container = $("print-content");
  container.replaceChildren(...recipes.map(recipe => {
    const article = typedContent(recipe);
    const pages = scans(recipe);
    if (includeScans && pages.length) article.append(scanContent(pages));
    return article;
  }));
  const images = [...container.querySelectorAll("img")];
  if (images.length) await Promise.race([
    Promise.allSettled(images.map(img => img.decode())),
    new Promise(resolve => setTimeout(resolve, 5000))
  ]);
  window.print();
}

$("file").addEventListener("change", event => {
  const file = event.target.files[0];
  event.target.value = "";
  importBook(file);
});
$("import").addEventListener("click", () => { if (!busy) $("file").click(); });
$("export").addEventListener("click", exportBook);
$("complete").addEventListener("click", exportBook);
$("print-all").addEventListener("click", () => printRecipes(sortedRecipes(), true));
$("add").addEventListener("click", () => { if (!busy && allowDiscard()) editRecipe(); });
$("search").addEventListener("input", renderList);
$("category").addEventListener("change", renderList);
document.querySelector(".brand").addEventListener("click", event => {
  event.preventDefault();
  if (allowDiscard()) showRecipe(null);
});

async function start() {
  try {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open(bookName, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("working");
      open.onerror = reject;
      open.onblocked = reject;
      open.onsuccess = () => {
        const opened = open.result;
        const read = opened.transaction("working").objectStore("working").get("copy");
        read.onerror = () => { opened.close(); reject(read.error); };
        read.onsuccess = () => {
          try {
            if (read.result) {
              state = { book: Cookbook.validate(read.result.book), dirty: Boolean(read.result.dirty) };
              localToken = read.result.token;
            }
            database = opened;
            resolve();
          } catch (error) {
            opened.close();
            reject(error);
          }
        };
      };
    });
  } catch {
    localProblem = "Browser storage is unavailable or unreadable. Keep this tab open and export your work.";
  } finally {
    busy = false;
    showRecipe(null, false);
  }
}

start();
