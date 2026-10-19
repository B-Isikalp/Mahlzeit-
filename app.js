(() => {
  "use strict";

  const API_BASE = "https://www.themealdb.com/api/json/v1/1/";
  const PAGE_SIZE = 12;
  const state = {
    meals: [],
    visibleMeals: [],
    categories: [],
    activeCategory: "",
    query: "",
    mode: "initial",
    loading: false,
    page: 1,
    requestToken: 0,
    currentMeal: null,
    previousScroll: 0
  };

  const $ = (selector) => document.querySelector(selector);
  const overviewView = $("#overviewView");
  const recipeView = $("#recipeView");
  const mealGrid = $("#mealGrid");
  const statusMessage = $("#statusMessage");
  const categoryChips = $("#categoryChips");
  const resultsLabel = $("#resultsLabel");
  const resultsCount = $("#resultsCount");
  const loadMoreButton = $("#loadMoreButton");
  const searchInput = $("#searchInput");
  const toast = $("#toast");
  let toastTimer;

  const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function toastMessage(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  async function fetchJSON(endpoint, { signal } = {}) {
    const response = await fetch(API_BASE + endpoint, {
      signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Server antwortet mit Status ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== "object") throw new Error("Die Antwort der Rezeptdatenbank war ungültig.");
    return data;
  }

  function setStatus(type, title, message, action = "") {
    statusMessage.hidden = false;
    statusMessage.className = "status-message";
    let icon = "";
    if (type === "loading") icon = '<div class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></div>';
    const actionHTML = action ? `<button type="button" class="button button-outline" id="statusAction">${escapeHTML(action)}</button>` : "";
    statusMessage.innerHTML = `${icon}<strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p>${actionHTML}`;
  }

  function setLoadingCards() {
    statusMessage.hidden = true;
    mealGrid.innerHTML = Array.from({ length: 8 }, () => `
      <article class="meal-card skeleton" aria-hidden="true">
        <div class="card-image-wrap"></div><div class="card-body"></div>
      </article>`).join("");
    loadMoreButton.hidden = true;
  }

  function normalizeMeal(meal) {
    return {
      id: meal.idMeal,
      name: meal.strMeal || "Unbenanntes Gericht",
      category: meal.strCategory || "",
      area: meal.strArea || "",
      image: meal.strMealThumb || "",
      instructions: meal.strInstructions || "",
      youtube: meal.strYoutube || "",
      ingredients: Array.from({ length: 20 }, (_, index) => {
        const n = index + 1;
        return {
          name: (meal[`strIngredient${n}`] || "").trim(),
          measure: (meal[`strMeasure${n}`] || "").trim()
        };
      }).filter((ingredient) => ingredient.name)
    };
  }

  function mealCardHTML(meal) {
    const mealData = normalizeMeal(meal);
    const category = mealData.category || "Rezeptidee";
    return `
      <article class="meal-card" tabindex="0" role="button" aria-label="Rezept ${escapeHTML(mealData.name)} öffnen" data-meal-id="${escapeHTML(mealData.id)}">
        <div class="card-image-wrap">
          <img class="card-image" src="${escapeHTML(mealData.image)}" alt="${escapeHTML(mealData.name)}" loading="lazy"
            onerror="this.onerror=null;this.src='https://placehold.co/600x500/e8ede6/1f4a3a?text=Mahlzeit'">
          <span class="card-tag">${escapeHTML(category)}</span>
        </div>
        <div class="card-body">
          <span class="card-area">${escapeHTML(mealData.area || "Aus aller Welt")}</span>
          <h3 class="card-title">${escapeHTML(mealData.name)}</h3>
          <div class="card-bottom"><span>Rezept entdecken</span><span class="card-arrow" aria-hidden="true">↗</span></div>
        </div>
      </article>`;
  }

  function showMeals(meals, { append = false, label = "Ein paar Ideen für dich" } = {}) {
    const validMeals = Array.isArray(meals) ? meals.filter((meal) => meal && meal.idMeal) : [];
    if (!append) {
      state.meals = validMeals;
      state.visibleMeals = validMeals.slice();
      state.page = 1;
      mealGrid.innerHTML = "";
    } else {
      const existingIds = new Set(state.visibleMeals.map((meal) => meal.idMeal));
      const unique = validMeals.filter((meal) => !existingIds.has(meal.idMeal));
      state.meals = state.meals.concat(unique);
      state.visibleMeals = state.visibleMeals.concat(unique);
    }
    statusMessage.hidden = true;
    resultsLabel.textContent = label;
    resultsCount.textContent = `${state.visibleMeals.length} ${state.visibleMeals.length === 1 ? "Gericht" : "Gerichte"}`;
    if (!state.visibleMeals.length) {
      mealGrid.innerHTML = "";
      setStatus("empty", "Hier ist noch nichts auf dem Teller", "Wir haben dazu keine Rezepte gefunden. Versuch einen anderen Suchbegriff oder setze den Filter zurück.");
      loadMoreButton.hidden = true;
      return;
    }
    mealGrid.innerHTML = state.visibleMeals.map(mealCardHTML).join("");
    loadMoreButton.hidden = state.mode === "category" || state.mode === "search" || state.mode === "random" || state.visibleMeals.length < PAGE_SIZE;
  }

  async function loadInitialMeals() {
    const token = ++state.requestToken;
    state.mode = "initial";
    state.activeCategory = "";
    state.query = "";
    searchInput.value = "";
    renderCategoryChips();
    resultsLabel.textContent = "Ein paar Ideen für dich";
    setLoadingCards();
    try {
      // TheMealDB has no general "all meals" endpoint on the free test key.
      // Use a set of popular initial letters, then deduplicate the returned meals.
      const letters = ["a", "b", "c", "d"];
      const results = await Promise.all(letters.map((letter) => fetchJSON(`search.php?f=${letter}`)));
      if (token !== state.requestToken) return;
      const all = results.flatMap((result) => Array.isArray(result.meals) ? result.meals : []);
      const unique = [...new Map(all.map((meal) => [meal.idMeal, meal])).values()];
      showMeals(unique.slice(0, PAGE_SIZE), { label: "Ein paar Ideen für dich" });
      state.meals = unique.slice(0, PAGE_SIZE);
      state.visibleMeals = state.meals.slice();
      loadMoreButton.hidden = true;
      resultsCount.textContent = "Ausgewählte Rezepte";
    } catch (error) {
      if (token !== state.requestToken) return;
      console.error("Initiale Rezepte konnten nicht geladen werden:", error);
      mealGrid.innerHTML = "";
      setStatus("error", "Die Küche bleibt nicht kalt – versprochen!", "Die Rezepte konnten gerade nicht geladen werden. Prüfe deine Internetverbindung und versuche es erneut.", "Erneut versuchen");
      $("#statusAction")?.addEventListener("click", loadInitialMeals, { once: true });
      resultsCount.textContent = "";
    }
  }

  async function searchMeals(query) {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      toastMessage("Gib zuerst einen Suchbegriff ein.");
      searchInput.focus();
      return;
    }
    const token = ++state.requestToken;
    state.mode = "search";
    state.query = cleanQuery;
    state.activeCategory = "";
    renderCategoryChips();
    resultsLabel.textContent = `Suchergebnisse für „${cleanQuery}“`;
    setLoadingCards();
    try {
      const data = await fetchJSON(`search.php?s=${encodeURIComponent(cleanQuery)}`);
      if (token !== state.requestToken) return;
      showMeals(data.meals, { label: `Suchergebnisse für „${cleanQuery}“` });
      if (Array.isArray(data.meals) && data.meals.length) toastMessage(`${data.meals.length} Rezept${data.meals.length === 1 ? "" : "e"} gefunden`);
    } catch (error) {
      if (token !== state.requestToken) return;
      console.error("Rezeptsuche fehlgeschlagen:", error);
      mealGrid.innerHTML = "";
      setStatus("error", "Die Suche hat gerade Küchenpause", "Die Rezeptdatenbank ist momentan nicht erreichbar. Bitte versuche es gleich noch einmal.", "Erneut versuchen");
      $("#statusAction")?.addEventListener("click", () => searchMeals(cleanQuery), { once: true });
    }
  }

  async function loadCategory(category) {
    const token = ++state.requestToken;
    state.mode = category ? "category" : "initial";
    state.activeCategory = category;
    state.query = "";
    searchInput.value = "";
    renderCategoryChips();
    resultsLabel.textContent = category ? `${category} – unsere Auswahl` : "Ein paar Ideen für dich";
    if (!category) return loadInitialMeals();
    setLoadingCards();
    try {
      const data = await fetchJSON(`filter.php?c=${encodeURIComponent(category)}`);
      if (token !== state.requestToken) return;
      if (!Array.isArray(data.meals) || !data.meals.length) {
        showMeals([], { label: `${category} – unsere Auswahl` });
        return;
      }
      // filter.php only provides IDs, names and thumbnails; fetch full details in parallel.
      const details = await Promise.all(data.meals.slice(0, 24).map(async (item) => {
        try {
          const detail = await fetchJSON(`lookup.php?i=${encodeURIComponent(item.idMeal)}`);
          return Array.isArray(detail.meals) ? detail.meals[0] : item;
        } catch {
          return item;
        }
      }));
      if (token !== state.requestToken) return;
      showMeals(details, { label: `${category} – unsere Auswahl` });
    } catch (error) {
      if (token !== state.requestToken) return;
      console.error("Kategorie konnte nicht geladen werden:", error);
      mealGrid.innerHTML = "";
      setStatus("error", "Diese Kategorie ist gerade nicht verfügbar", "Wir konnten die Gerichte nicht laden. Bitte probiere es noch einmal.", "Erneut versuchen");
      $("#statusAction")?.addEventListener("click", () => loadCategory(category), { once: true });
    }
  }

  async function loadCategories() {
    try {
      const data = await fetchJSON("categories.php");
      state.categories = Array.isArray(data.categories) ? data.categories : [];
      renderCategoryChips();
    } catch (error) {
      console.warn("Kategorien konnten nicht geladen werden:", error);
      // The app remains usable via search if category loading is unavailable.
    }
  }

  function renderCategoryChips() {
    const categoryButtons = state.categories.map((category) => {
      const name = category.strCategory;
      return `<button class="chip ${state.activeCategory === name ? "active" : ""}" data-category="${escapeHTML(name)}" type="button" aria-pressed="${state.activeCategory === name}">${escapeHTML(name)}</button>`;
    }).join("");
    categoryChips.innerHTML = `<button class="chip ${state.activeCategory ? "" : "active"}" data-category="" type="button" aria-pressed="${!state.activeCategory}">Alle Gerichte</button>${categoryButtons}`;
    categoryChips.querySelectorAll("[data-category]").forEach((button) => {
      button.addEventListener("click", () => loadCategory(button.dataset.category));
    });
  }

  async function openRandomMeal() {
    const token = ++state.requestToken;
    state.mode = "random";
    state.previousScroll = window.scrollY;
    mealGrid.innerHTML = "";
    setLoadingCards();
    resultsLabel.textContent = "Ein kleines Küchenabenteuer";
    setStatus("loading", "Der Zufall kocht mit …", "Wir suchen ein Gericht für dich.");
    try {
      const data = await fetchJSON("random.php");
      if (token !== state.requestToken) return;
      const meal = Array.isArray(data.meals) ? data.meals[0] : null;
      if (!meal) throw new Error("Kein Zufallsgericht erhalten.");
      renderRecipe(normalizeMeal(meal));
    } catch (error) {
      if (token !== state.requestToken) return;
      console.error("Zufallsrezept konnte nicht geladen werden:", error);
      setStatus("error", "Der Zufall braucht einen zweiten Versuch", "Das Zufallsrezept konnte gerade nicht geladen werden.", "Erneut versuchen");
      $("#statusAction")?.addEventListener("click", openRandomMeal, { once: true });
    }
  }

  async function openMealById(id) {
    if (!id) return;
    const token = ++state.requestToken;
    state.previousScroll = window.scrollY;
    overviewView.hidden = true;
    recipeView.hidden = false;
    $("#recipeContent").innerHTML = `<div class="status-message"><div class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></div><strong>Rezept wird vorbereitet …</strong><p>Einen kleinen Moment, bitte.</p></div>`;
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const data = await fetchJSON(`lookup.php?i=${encodeURIComponent(id)}`);
      if (token !== state.requestToken) return;
      const meal = Array.isArray(data.meals) ? data.meals[0] : null;
      if (!meal) throw new Error("Dieses Rezept wurde nicht gefunden.");
      renderRecipe(normalizeMeal(meal));
    } catch (error) {
      if (token !== state.requestToken) return;
      console.error("Rezeptdetails konnten nicht geladen werden:", error);
      $("#recipeContent").innerHTML = `<div class="status-message"><strong>Das Rezept ist gerade nicht erreichbar</strong><p>Bitte prüfe deine Verbindung und versuche es erneut.</p><button id="retryRecipe" class="button button-outline" type="button">Erneut versuchen</button></div>`;
      $("#retryRecipe").addEventListener("click", () => openMealById(id));
    }
  }

  function splitInstructions(text) {
    const clean = (text || "").replace(/\r/g, "").trim();
    if (!clean) return [];
    const paragraphs = clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    if (paragraphs.length > 1) return paragraphs;
    // Some API entries use one long paragraph. Split at sentence boundaries as a readable fallback.
    const sentences = clean.replace(/\n/g, " ").split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/);
    if (sentences.length > 1) {
      const chunks = [];
      for (let i = 0; i < sentences.length; i += 2) chunks.push(sentences.slice(i, i + 2).join(" "));
      return chunks;
    }
    return [clean];
  }

  function renderRecipe(meal) {
    state.currentMeal = meal;
    overviewView.hidden = true;
    recipeView.hidden = false;
    const instructions = splitInstructions(meal.instructions);
    const ingredientHTML = meal.ingredients.length ? meal.ingredients.map((ingredient) => `
      <li><input class="ingredient-check" type="checkbox" aria-label="${escapeHTML(ingredient.name)} abhaken"><span class="ingredient-text">${escapeHTML(ingredient.name)}</span><span class="ingredient-measure">${escapeHTML(ingredient.measure)}</span></li>`).join("") : `<li>Für dieses Rezept sind keine Zutaten angegeben.</li>`;
    const stepsHTML = instructions.length ? instructions.map((step) => `<li><p>${escapeHTML(step)}</p></li>`).join("") : `<li><p>Für dieses Rezept sind keine Zubereitungsschritte hinterlegt.</p></li>`;
    const videoButton = meal.youtube && /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(meal.youtube)
      ? `<a class="button button-dark" href="${escapeHTML(meal.youtube)}" target="_blank" rel="noopener noreferrer">Video ansehen <span aria-hidden="true">↗</span></a>` : "";
    $("#recipeContent").innerHTML = `
      <div class="recipe-hero">
        <div class="recipe-image-wrap">
          <img class="recipe-image" src="${escapeHTML(meal.image)}" alt="${escapeHTML(meal.name)}" onerror="this.onerror=null;this.src='https://placehold.co/900x800/e8ede6/1f4a3a?text=Mahlzeit'">
          <span class="recipe-image-badge">✳ Mit Liebe gekocht</span>
        </div>
        <div class="recipe-intro">
          <p class="eyebrow"><span class="eyebrow-line"></span> ZEIT FÜR GUTES ESSEN</p>
          <h1>${escapeHTML(meal.name)}</h1>
          <p class="recipe-summary">Ein Gericht zum Genießen – mit Zutaten und Zubereitung direkt auf einen Blick.</p>
          <div class="recipe-meta">
            ${meal.category ? `<span class="meta-pill">✳ ${escapeHTML(meal.category)}</span>` : ""}
            ${meal.area ? `<span class="meta-pill">◎ ${escapeHTML(meal.area)} Küche</span>` : ""}
            <span class="meta-pill">☷ ${meal.ingredients.length} Zutaten</span>
          </div>
          <div class="recipe-actions">${videoButton}<button class="button button-outline" id="shareRecipeButton" type="button">Rezept teilen ↗</button></div>
        </div>
      </div>
      <div class="recipe-layout">
        <section class="recipe-panel">
          <div class="panel-heading"><h2>Zutaten</h2><span class="ingredient-count">${meal.ingredients.length} Zutaten</span></div>
          <ul class="ingredient-list">${ingredientHTML}</ul>
          <p class="recipe-note">Tipp: Hake die Zutaten beim Vorbereiten einfach ab.</p>
        </section>
        <section class="recipe-panel instructions-panel">
          <div class="panel-heading"><h2>So geht’s</h2><span class="ingredient-count">${instructions.length || "–"} Schritte</span></div>
          <ol class="instructions">${stepsHTML}</ol>
        </section>
      </div>`;
    $("#shareRecipeButton").addEventListener("click", async () => {
      const shareData = { title: meal.name, text: `Schau dir dieses Rezept auf Mahlzeit an: ${meal.name}`, url: location.href };
      try {
        if (navigator.share) await navigator.share(shareData);
        else if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(location.href);
          toastMessage("Rezeptlink wurde kopiert.");
        } else {
          toastMessage("Kopiere den Link aus der Adresszeile, um das Rezept zu teilen.");
        }
      } catch (error) {
        if (error.name !== "AbortError") toastMessage("Teilen war gerade nicht möglich.");
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToOverview() {
    ++state.requestToken;
    recipeView.hidden = true;
    overviewView.hidden = false;
    window.scrollTo({ top: state.previousScroll || 0, behavior: "smooth" });
  }

  $("#searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    searchMeals(searchInput.value);
  });
  $("#surpriseButton").addEventListener("click", openRandomMeal);
  $("#backButton").addEventListener("click", backToOverview);
  $("#homeLink").addEventListener("click", (event) => {
    event.preventDefault();
    if (!recipeView.hidden) backToOverview();
    else loadInitialMeals();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#footerHome").addEventListener("click", (event) => {
    event.preventDefault();
    backToOverview();
  });
  mealGrid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-meal-id]");
    if (card) openMealById(card.dataset.mealId);
  });
  mealGrid.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-meal-id]")) {
      event.preventDefault();
      openMealById(event.target.dataset.mealId);
    }
  });
  loadMoreButton.addEventListener("click", () => {
    toastMessage("Nutze eine Kategorie oder die Suche für weitere Rezepte.");
  });

  // Load categories and the initial selection concurrently. All API calls use the public test key.
  loadCategories();
  loadInitialMeals();
})();