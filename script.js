/* Cloudflare Worker endpoint that safely proxies requests to OpenAI */
const WORKER_URL = "https://wonderbot-worker.baikeda.workers.dev";
const STORAGE_KEY = "lorealSelectedProducts";
const DIR_STORAGE_KEY = "lorealTextDirection";

/* Get references to DOM elements */
const dirToggleBtn = document.getElementById("dirToggle");
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const clearSelectedBtn = document.getElementById("clearSelected");
const generateRoutineBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatWindow = document.getElementById("chatWindow");

/* Store loaded products and user-selected products */
let allProducts = [];
let selectedProducts = loadSavedProducts();

/* Keep the full conversation history so the AI remembers context on follow-ups */
const messages = [
  {
    role: "system",
    content:
      "You are a L'Oréal beauty and routine advisor. Build clear, concise, step-by-step routines (with AM/PM order when helpful) using the user's selected products, and remember the full conversation history for follow-up questions. ONLY answer questions related to the generated routine, the selected products, or beauty and personal care topics such as skincare, haircare, hair color, hair styling, makeup, suncare, fragrance, and men's grooming. If the user asks about anything unrelated to their routine or beauty/personal care, politely decline and invite them to ask about their routine or L'Oréal products instead. When current web search references are provided, incorporate up-to-date details and include clickable Markdown links [Source Title](URL) where helpful. Never invent URLs.",
  },
];

/* Show initial placeholder until user selects a category or enters a search term */
function showInitialPlaceholder() {
  productsContainer.innerHTML = `
    <div class="placeholder-message">
      Select a category or search by keyword to view products
    </div>
  `;
}

showInitialPlaceholder();

/* Load any previously selected products from localStorage */
function loadSavedProducts() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* Save selected products to localStorage (or clear key when empty) */
function saveSelectedProducts() {
  try {
    if (selectedProducts.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedProducts));
    }
  } catch {
    // Ignore storage errors if localStorage is unavailable
  }
}

/* Safely escape HTML characters before inserting text into templates */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

/* Safely convert Markdown links, raw URLs, and **bold** text to HTML */
function formatRichMessage(text) {
  let safe = escapeHtml(text);
  const linkPlaceholders = [];

  // Replace Markdown links [label](https://...) first with placeholders
  safe = safe.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label, url) => {
      const token = `__LINK_TOKEN_${linkPlaceholders.length}__`;
      linkPlaceholders.push(
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
      );
      return token;
    }
  );

  // Convert remaining plain URLs into clickable links
  safe = safe.replace(/(https?:\/\/[^\s<]+)/g, (rawUrl) => {
    const cleanUrl = rawUrl.replace(/[.,!?;:)\]]+$/, "");
    const trailing = rawUrl.slice(cleanUrl.length);
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
  });

  // Restore Markdown link placeholders
  linkPlaceholders.forEach((anchorHtml, index) => {
    safe = safe.replace(`__LINK_TOKEN_${index}__`, anchorHtml);
  });

  // Format **bold** segments cleanly
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return safe;
}

/* Load product data from products.json */
async function loadProducts() {
  if (allProducts.length > 0) {
    return allProducts;
  }
  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products;
  return allProducts;
}

/* Check if a product is currently selected */
function isProductSelected(productId) {
  return selectedProducts.some((item) => item.id === productId);
}

/* Toggle a product in or out of the selectedProducts list */
function toggleProductSelection(product) {
  if (isProductSelected(product.id)) {
    selectedProducts = selectedProducts.filter((item) => item.id !== product.id);
  } else {
    selectedProducts.push(product);
  }
  saveSelectedProducts();
  renderSelectedProducts();
  updateProductCardSelectionStates();
}

/* Update the visual selected state on visible product cards */
function updateProductCardSelectionStates() {
  const cards = productsContainer.querySelectorAll(".product-card");
  cards.forEach((card) => {
    const productId = Number(card.dataset.id);
    const selected = isProductSelected(productId);
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));

    const badge = card.querySelector(".selected-badge");
    if (badge) {
      badge.textContent = selected ? "✓ Selected" : "";
    }
  });
}

/* Render the Selected Products section */
function renderSelectedProducts() {
  clearSelectedBtn.hidden = selectedProducts.length === 0;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="empty-selected">
        No products selected yet. Click a product card above to add it to your routine.
      </p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
      <div class="selected-product-item" data-id="${product.id}">
        <span>${escapeHtml(product.brand)} &middot; ${escapeHtml(product.name)}</span>
        <button
          type="button"
          class="remove-btn"
          data-remove-id="${product.id}"
          aria-label="Remove ${escapeHtml(product.name)}"
        >&times;</button>
      </div>
    `
    )
    .join("");
}

/* Create HTML for displaying product cards in the grid */
function displayProducts(products) {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No matching products found. Try another category or keyword.
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const selected = isProductSelected(product.id);
      return `
        <div
          class="product-card ${selected ? "selected" : ""}"
          data-id="${product.id}"
          role="button"
          tabindex="0"
          aria-pressed="${selected}"
        >
          <div class="product-image-stage">
            <img
              src="${escapeHtml(product.image)}"
              alt="${escapeHtml(product.brand)} ${escapeHtml(product.name)}"
              referrerpolicy="no-referrer"
            />
          </div>
          <div class="product-card-body">
            <div class="product-info">
              <p class="product-brand">${escapeHtml(product.brand)}</p>
              <h3>${escapeHtml(product.name)}</h3>
            </div>
            <p id="desc-${product.id}" class="product-description" hidden>${escapeHtml(product.description)}</p>
            <div class="product-card-actions">
              <button
                type="button"
                class="details-btn"
                aria-expanded="false"
                aria-controls="desc-${product.id}"
                aria-label="Show details for ${escapeHtml(product.name)}"
              >
                <i class="fa-solid fa-circle-info" aria-hidden="true"></i> Details
              </button>
              <span class="selected-badge">${selected ? "✓ Selected" : ""}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  // Provide a clean fallback container if an external image fails to load
  const images = productsContainer.querySelectorAll(".product-image-stage img");
  images.forEach((img) => {
    img.addEventListener("error", () => {
      const stage = img.closest(".product-image-stage");
      const card = img.closest(".product-card");
      const brand = card?.querySelector(".product-brand")?.textContent || "L'ORÉAL";
      const name = card?.querySelector("h3")?.textContent || "";
      if (stage) {
        stage.innerHTML = `
          <div class="product-image-fallback">
            <strong>${escapeHtml(brand.toUpperCase())}</strong>
            <span>${escapeHtml(name)}</span>
          </div>
        `;
      }
    });
  });
}

/* Add a message bubble to the chat window (with optional clickable citations) */
function appendChatMessage(role, text, extraClass = "", citations = []) {
  const messageEl = document.createElement("div");
  messageEl.className = `chat-message ${role} ${extraClass}`.trim();

  if (role === "assistant" && !extraClass) {
    const bodyEl = document.createElement("div");
    bodyEl.innerHTML = formatRichMessage(text);
    messageEl.appendChild(bodyEl);

    if (Array.isArray(citations) && citations.length > 0) {
      const citationsEl = document.createElement("div");
      citationsEl.className = "chat-citations";
      citationsEl.innerHTML = `
        <div class="chat-citations-title">Sources &amp; Links</div>
        <ul>
          ${citations
            .map(
              (item) => `
              <li>
                <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                  ${escapeHtml(item.title || item.url)}
                </a>
              </li>
            `
            )
            .join("")}
        </ul>
      `;
      messageEl.appendChild(citationsEl);
    }
  } else {
    messageEl.textContent = text;
  }

  chatWindow.appendChild(messageEl);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return messageEl;
}

/* Enable or disable request controls while waiting for the API */
function setLoadingState(isLoading) {
  generateRoutineBtn.disabled = isLoading;
  sendBtn.disabled = isLoading;
  userInput.disabled = isLoading;
}

/* Fetch current web context and verified URLs from our backend search endpoint */
async function fetchWebContext(query) {
  try {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(query)}`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

/* Extract unique citations from Worker annotations and relevant live web search results */
function collectCitations(apiMessage, webResults, replyText = "") {
  const seenUrls = new Set();
  const citations = [];

  const addCitation = (title, url) => {
    if (!url || !/^https?:\/\//i.test(url) || seenUrls.has(url)) return;
    seenUrls.add(url);
    citations.push({ title: title || url, url });
  };

  // Handle OpenAI url_citation annotations if returned by the Worker
  if (Array.isArray(apiMessage?.annotations)) {
    apiMessage.annotations.forEach((ann) => {
      if (ann?.type === "url_citation" && ann.url_citation?.url) {
        addCitation(ann.url_citation.title, ann.url_citation.url);
      } else if (ann?.url) {
        addCitation(ann.title, ann.url);
      }
    });
  }

  // Only attach web search citations when the reply is an on-topic beauty/routine answer
  const isRefusal =
    /politely decline|only answer questions related|outside (?:my|the) scope/i.test(
      replyText
    );
  if (!isRefusal && Array.isArray(webResults)) {
    webResults.forEach((item) => addCitation(item.title, item.url));
  }

  return citations;
}

/* Send messages (plus live web context) to the Cloudflare Worker and return reply + citations */
async function fetchAdvisorReply(searchQuery) {
  const webResults = searchQuery ? await fetchWebContext(searchQuery) : [];

  // Build request messages with current web references injected for this turn
  const requestMessages = [...messages];
  if (webResults.length > 0) {
    const referenceText = webResults
      .map(
        (item, index) =>
          `${index + 1}. ${item.title} (${item.url})${item.snippet ? ` — ${item.snippet}` : ""}`
      )
      .join("\n");

    requestMessages.push({
      role: "system",
      content: `Current web search results related to this request (use up-to-date details and cite relevant links as [Title](URL) when answering):\n${referenceText}`,
    });
  }

  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: requestMessages }),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMessage =
      data?.error?.message || "Unable to reach the beauty advisor right now.";
    throw new Error(errorMessage);
  }

  const assistantMessage = data?.choices?.[0]?.message;
  const reply = assistantMessage?.content;
  if (!reply) {
    throw new Error("Received an empty response from the advisor.");
  }

  const citations = collectCitations(assistantMessage, webResults, reply);
  return { reply, citations };
}

/* Normalize text for accent- and apostrophe-insensitive keyword matching */
function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "");
}

/* Filter products by both selected category and search keyword */
async function filterAndDisplayProducts() {
  const selectedCategory = categoryFilter.value;
  const rawQuery = productSearch.value.trim();

  if (!selectedCategory && !rawQuery) {
    showInitialPlaceholder();
    return;
  }

  const products = await loadProducts();
  const normalizedQuery = normalizeSearchText(rawQuery);

  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      !selectedCategory ||
      selectedCategory === "all" ||
      product.category === selectedCategory;

    if (!matchesCategory) return false;
    if (!normalizedQuery) return true;

    const searchableText = normalizeSearchText(
      `${product.name} ${product.brand} ${product.category} ${product.description}`
    );
    return searchableText.includes(normalizedQuery);
  });

  displayProducts(filteredProducts);
}

/* Filter and display products when the category dropdown or search input changes */
categoryFilter.addEventListener("change", filterAndDisplayProducts);
productSearch.addEventListener("input", filterAndDisplayProducts);

/* Handle clicks on product cards (toggle selection or show/hide details) */
productsContainer.addEventListener("click", async (e) => {
  const detailsBtn = e.target.closest(".details-btn");
  const card = e.target.closest(".product-card");
  if (!card) return;

  if (detailsBtn) {
    e.stopPropagation();
    const descriptionEl = card.querySelector(".product-description");
    const productName = card.querySelector("h3")?.textContent || "product";
    if (descriptionEl) {
      const isHidden = descriptionEl.hasAttribute("hidden");
      if (isHidden) {
        descriptionEl.removeAttribute("hidden");
        detailsBtn.setAttribute("aria-expanded", "true");
        detailsBtn.setAttribute("aria-label", `Hide details for ${productName}`);
        detailsBtn.innerHTML =
          '<i class="fa-solid fa-chevron-up" aria-hidden="true"></i> Hide Details';
      } else {
        descriptionEl.setAttribute("hidden", "");
        detailsBtn.setAttribute("aria-expanded", "false");
        detailsBtn.setAttribute("aria-label", `Show details for ${productName}`);
        detailsBtn.innerHTML =
          '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> Details';
      }
    }
    return;
  }

  // Allow users to highlight/copy description text without toggling selection
  if (e.target.closest(".product-description")) {
    return;
  }

  const products = await loadProducts();
  const productId = Number(card.dataset.id);
  const clickedProduct = products.find((item) => item.id === productId);
  if (clickedProduct) {
    toggleProductSelection(clickedProduct);
  }
});

/* Support keyboard selection on product cards with Enter or Space */
productsContainer.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (e.target.closest(".details-btn")) return;

  const card = e.target.closest(".product-card");
  if (!card) return;

  e.preventDefault();
  const products = await loadProducts();
  const productId = Number(card.dataset.id);
  const clickedProduct = products.find((item) => item.id === productId);
  if (clickedProduct) {
    toggleProductSelection(clickedProduct);
  }
});

/* Handle removing a product from the Selected Products list */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest("[data-remove-id]");
  if (!removeBtn) return;

  const removeId = Number(removeBtn.dataset.removeId);
  selectedProducts = selectedProducts.filter((item) => item.id !== removeId);
  saveSelectedProducts();
  renderSelectedProducts();
  updateProductCardSelectionStates();
});

/* Clear all selected products at once */
clearSelectedBtn.addEventListener("click", () => {
  selectedProducts = [];
  saveSelectedProducts();
  renderSelectedProducts();
  updateProductCardSelectionStates();
});

/* Generate a personalized routine from the currently selected products */
generateRoutineBtn.addEventListener("click", async () => {
  if (selectedProducts.length === 0) {
    appendChatMessage(
      "assistant",
      "Please select at least one product first, then click Generate Routine."
    );
    return;
  }

  // Format selected product details for the AI prompt
  const productDetails = selectedProducts
    .map(
      (product) =>
        `- ${product.brand} ${product.name} (${product.category}): ${product.description}`
    )
    .join("\n");

  const promptText = `Build a personalized step-by-step routine using these selected products:\n${productDetails}`;
  const productNames = selectedProducts.map((p) => p.name).join(", ");
  const searchQuery = `L'Oreal ${selectedProducts
    .slice(0, 2)
    .map((p) => `${p.brand} ${p.name}`)
    .join(" ")} routine`;

  // Show a concise summary in the chat UI and send full product details to the AI
  appendChatMessage("user", `Generate a routine using: ${productNames}`);
  messages.push({ role: "user", content: promptText });

  const loadingBubble = appendChatMessage(
    "assistant",
    "Building your personalized routine...",
    "loading"
  );
  setLoadingState(true);

  try {
    const { reply, citations } = await fetchAdvisorReply(searchQuery);
    loadingBubble.remove();
    messages.push({ role: "assistant", content: reply });
    appendChatMessage("assistant", reply, "", citations);
  } catch (error) {
    loadingBubble.remove();
    messages.pop();
    appendChatMessage("assistant", `Error: ${error.message}`, "error");
  } finally {
    setLoadingState(false);
  }
});

/* Handle follow-up questions in the chat form */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = userInput.value.trim();
  if (!text) return;

  userInput.value = "";
  appendChatMessage("user", text);
  messages.push({ role: "user", content: text });

  const loadingBubble = appendChatMessage(
    "assistant",
    "Thinking...",
    "loading"
  );
  setLoadingState(true);

  const searchQuery = /l'?or[eé]al/i.test(text)
    ? text
    : `L'Oreal ${text}`;

  try {
    const { reply, citations } = await fetchAdvisorReply(searchQuery);
    loadingBubble.remove();
    messages.push({ role: "assistant", content: reply });
    appendChatMessage("assistant", reply, "", citations);
  } catch (error) {
    loadingBubble.remove();
    messages.pop();
    appendChatMessage("assistant", `Error: ${error.message}`, "error");
  } finally {
    setLoadingState(false);
    userInput.focus();
  }
});

/* Apply text direction (ltr or rtl) to the document and update the toggle button */
function applyDirection(direction) {
  const isRtl = direction === "rtl";
  document.documentElement.setAttribute("dir", isRtl ? "rtl" : "ltr");

  if (dirToggleBtn) {
    dirToggleBtn.setAttribute("aria-pressed", String(isRtl));
    dirToggleBtn.setAttribute(
      "aria-label",
      isRtl
        ? "Switch layout to left-to-right (LTR)"
        : "Switch layout to right-to-left (RTL)"
    );
    const labelSpan = dirToggleBtn.querySelector("span");
    if (labelSpan) {
      labelSpan.textContent = isRtl ? "LTR" : "RTL";
    }
  }
}

/* Detect saved direction or RTL browser language on page load */
function initDirection() {
  let savedDir = null;
  try {
    savedDir = localStorage.getItem(DIR_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }

  if (savedDir === "rtl" || savedDir === "ltr") {
    applyDirection(savedDir);
    return;
  }

  const docDir = document.documentElement.getAttribute("dir");
  const isRtlLocale = /^(ar|he|iw|fa|ur|ps|yi)\b/i.test(
    navigator.language || ""
  );
  applyDirection(docDir === "rtl" || isRtlLocale ? "rtl" : "ltr");
}

/* Allow switching between LTR and RTL mode from the header toggle */
if (dirToggleBtn) {
  dirToggleBtn.addEventListener("click", () => {
    const currentDir = document.documentElement.getAttribute("dir");
    const nextDir = currentDir === "rtl" ? "ltr" : "rtl";
    applyDirection(nextDir);
    try {
      localStorage.setItem(DIR_STORAGE_KEY, nextDir);
    } catch {
      // Ignore storage errors
    }
  });
}

/* Initialize direction, selected products list, and welcome message on page load */
initDirection();
renderSelectedProducts();
appendChatMessage(
  "assistant",
  "Hello! Choose a product category above, click products to add them to your routine, and press Generate Routine—or ask me any beauty question below."
);
