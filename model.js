"use strict";

const Cookbook = (() => {
  const format = "our-family-table-portable";
  const empty = () => ({ format, version: 2, exportedAt: null, recipes: [], history: [] });
  const isObject = value => value && typeof value === "object" && !Array.isArray(value);
  const strings = value => Array.isArray(value) && value.every(entry => typeof entry === "string");
  const timestamp = value => typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value));
  const image = value => typeof value === "string" &&
    /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|tiff|heic|heif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z\d+/]+={0,2}$/i.test(value);
  // Preserve legacy data even when the browser lacks a decoder for that format.
  const legacyImage = value => typeof value === "string" && /^data:image\/[\w.+-]+(?:;[^,]*)?,.+/is.test(value);
  const typed = ({ title, category, ingredients, directions, notes }) => ({ title, category, ingredients, directions, notes });
  const validTyped = value => isObject(value) && typeof value.title === "string" && value.title.trim() &&
    typeof value.category === "string" && strings(value.ingredients) && strings(value.directions) &&
    typeof value.notes === "string";
  const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  function validate(book) {
    if (!isObject(book) || book.format !== format || book.version !== 2 ||
        !Array.isArray(book.recipes) || !Array.isArray(book.history) ||
        !(book.exportedAt === null || timestamp(book.exportedAt))) {
      throw Error("Choose an Our Family Table version 2 cookbook JSON file.");
    }
    const originals = book.sources === undefined ? [] : book.sources;
    if (!Array.isArray(originals)) throw Error("The source image list is invalid.");
    const sourceIds = new Set();
    for (const source of originals) {
      if (!isObject(source) || typeof source.id !== "string" || !source.id.trim() ||
          sourceIds.has(source.id) || !legacyImage(source.data) || typeof source.name !== "string") {
        throw Error("A source image record is invalid or has a duplicate ID.");
      }
      sourceIds.add(source.id);
    }
    const recipeIds = new Set();
    for (const recipe of book.recipes) {
      if (!validTyped(recipe) || typeof recipe.id !== "string" || !recipe.id.trim() ||
          recipeIds.has(recipe.id) || !(recipe.scanData == null || legacyImage(recipe.scanData)) ||
          (recipe.sourceIds !== undefined && (!strings(recipe.sourceIds) ||
            new Set(recipe.sourceIds).size !== recipe.sourceIds.length ||
            recipe.sourceIds.some(sourceId => !sourceIds.has(sourceId)))) ||
          (recipe.review !== undefined && typeof recipe.review !== "string")) {
        throw Error("A recipe has invalid fields, a duplicate ID or a missing source image.");
      }
      recipeIds.add(recipe.id);
    }
    for (const revision of book.history) {
      if (!isObject(revision) || !recipeIds.has(revision.recipeId) ||
          !timestamp(revision.savedAt) || !validTyped(revision.previous)) {
        throw Error("A revision has invalid fields or references an unknown recipe.");
      }
    }
    return book;
  }
  function revise(book, recipe, values) {
    if (JSON.stringify(typed(recipe)) === JSON.stringify(typed(values))) return book;
    return {
      ...book,
      history: [...book.history, { recipeId: recipe.id, savedAt: new Date().toISOString(), previous: typed(recipe) }],
      recipes: book.recipes.map(item => item.id === recipe.id ? { ...item, ...typed(values) } : item)
    };
  }
  return { empty, validate, typed, revise, id, image };
})();
