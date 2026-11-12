const STORAGE_BUCKET = "supplier-product-photos";
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SIGNED_URL_SECONDS = 3600;

/* Inline SVG icons: no Font Awesome needed */
const ICON_PATHS = {
    plus: `<path d="M12 5v14M5 12h14"/>`,
    xmark: `<path d="M18 6 6 18M6 6l12 12"/>`,
    trash: `<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>`,
    pen: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`,
    floppy: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>`,
    box: `<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>`,
    spinner: `<path d="M21 12a9 9 0 1 1-6.2-8.55"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path>`
};

const icon = name => `
    <i class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${ICON_PATHS[name]}
        </svg>
    </i>`;

export async function render({ supabase, user, supplier, view, escapeHTML }) {
    const supplierId = supplier.user_id;

    let products = [];
    let selectedPhoto = null;        // newly chosen file
    let currentPhotoPath = null;     // photo that will remain (null = none)
    let originalPhotoPath = null;    // photo the product had when editing began
    let editingProductId = null;
    let isSaving = false;
    let deleteTarget = null;
    let previewObjectUrl = null;

    const urlCache = new Map();

    const safe = value => escapeHTML(String(value ?? ""));

    const formatPrice = value =>
        Number(value || 0).toLocaleString("en-PH", {
            style: "currency",
            currency: "PHP"
        });

    view.innerHTML = `
        <section class="supplier-panel">
            <div class="panel-heading">
                <div>
                    <h3>My Products</h3>
                    <p>Manage the products associated with your supplier account.</p>
                </div>

                <button class="primary-button" id="addProductBtn" type="button">
                    ${icon("plus")} Add Product
                </button>
            </div>

            <div class="form-group">
                <input
                    id="productSearch"
                    type="search"
                    placeholder="Search your products..."
                    aria-label="Search products"
                />
            </div>

            <div id="productList">
                <div class="page-loading">
                    ${icon("spinner")} Loading products...
                </div>
            </div>
        </section>

        <!-- ADD / EDIT PRODUCT MODAL -->
        <div id="productModal" class="modal-overlay" hidden>
            <div class="modal-content" role="dialog"
                aria-modal="true" aria-labelledby="productModalTitle">

                <div class="panel-heading">
                    <div>
                        <h3 id="productModalTitle">Add Product</h3>
                        <p id="productModalDescription">
                            Enter your product information.
                        </p>
                    </div>

                    <button
                        type="button"
                        id="closeProductModal"
                        class="modal-close-btn"
                        aria-label="Close modal"
                        title="Close"
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </div>

                <form id="productForm">
                    <div class="form-group">
                        <label for="productName">Product Name *</label>
                        <input
                            id="productName"
                            type="text"
                            maxlength="150"
                            required
                            placeholder="Enter product name"
                        />
                    </div>

                    <div class="form-group">
                        <label for="productDescription">Description</label>
                        <textarea
                            id="productDescription"
                            rows="4"
                            placeholder="Describe your product..."
                        ></textarea>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="productPrice">Price (PHP) *</label>
                            <input
                                id="productPrice"
                                type="number"
                                min="0"
                                step="0.01"
                                required
                                value="0"
                            />
                        </div>

                        <div class="form-group">
                            <label for="productStock">Stock Quantity *</label>
                            <input
                                id="productStock"
                                type="number"
                                min="0"
                                step="0.01"
                                required
                                value="0"
                            />
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="productUnit">Unit</label>
                        <input
                            id="productUnit"
                            type="text"
                            maxlength="50"
                            placeholder="e.g. kg, sack, piece, box"
                        />
                    </div>

                    <div class="form-group">
                        <label for="productPhoto">Product Photo</label>

                        <input
                            id="productPhoto"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                        />

                        <small>
                            JPG, PNG or WEBP. Maximum file size: 3 MB.
                        </small>
                    </div>

                    <div id="photoPreviewContainer" hidden>
                        <div class="product-photo-preview">
                            <img
                                id="productPhotoPreview"
                                alt="Product photo preview"
                            />

                            <button type="button"
                                id="removeProductPhoto"
                                class="icon-button"
                                aria-label="Remove photo">
                                ${icon("trash")}
                            </button>
                        </div>
                    </div>

                    <div id="productFormError"
                        class="page-error" hidden></div>

                    <div class="panel-actions">
                        <button type="button" id="cancelProductBtn"
                            class="secondary-button">
                            Cancel
                        </button>

                        <button type="submit"
                            id="saveProductBtn"
                            class="primary-button">
                            ${icon("floppy")} Save Product
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- DELETE CONFIRMATION MODAL -->
        <div id="deleteProductModal" class="modal-overlay" hidden>
            <div class="modal-content" role="dialog"
                aria-modal="true" aria-labelledby="deleteProductTitle">

                <div class="panel-heading">
                    <div>
                        <h3 id="deleteProductTitle">Delete Product</h3>
                        <p>Are you sure you want to delete this product?</p>
                    </div>

                    <button
                        type="button"
                        id="closeDeleteModal"
                        class="modal-close-btn"
                        aria-label="Close modal"
                        title="Close"
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </div>

                <p id="deleteProductMessage"></p>

                <div class="panel-actions">
                    <button type="button"
                        id="cancelDeleteBtn"
                        class="secondary-button">
                        Cancel
                    </button>

                    <button type="button"
                        id="confirmDeleteBtn"
                        class="primary-button">
                        ${icon("trash")} Delete Product
                    </button>
                </div>
            </div>
        </div>
    `;

    const $ = selector => view.querySelector(selector);

    const list = $("#productList");
    const search = $("#productSearch");
    const modal = $("#productModal");
    const form = $("#productForm");
    const fileInput = $("#productPhoto");
    const previewContainer = $("#photoPreviewContainer");
    const previewImage = $("#productPhotoPreview");
    const formError = $("#productFormError");
    const saveButton = $("#saveProductBtn");

    const deleteModal = $("#deleteProductModal");
    const deleteMessage = $("#deleteProductMessage");
    const confirmDeleteButton = $("#confirmDeleteBtn");

    // =========================================
    // HELPERS
    // =========================================

    function showError(message) {
        formError.textContent = message;
        formError.hidden = false;
    }

    function clearError() {
        formError.textContent = "";
        formError.hidden = true;
    }

    function clearPreviewObjectUrl() {
        if (previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = null;
        }
    }

    function showPhotoPreview(source) {
        clearPreviewObjectUrl();
        previewImage.src = source;
        previewContainer.hidden = false;
    }

    function hidePhotoPreview() {
        clearPreviewObjectUrl();
        previewImage.removeAttribute("src");
        previewContainer.hidden = true;
    }

    function setSaveButtonState(saving) {
        saveButton.disabled = saving;
        saveButton.innerHTML = saving
            ? `${icon("spinner")} Saving...`
            : `${icon("floppy")} Save Product`;
    }

    function resetProductForm() {
        form.reset();
        fileInput.value = "";

        selectedPhoto = null;
        currentPhotoPath = null;
        originalPhotoPath = null;
        editingProductId = null;

        clearError();
        hidePhotoPreview();
    }

    function closeDeleteModal() {
        deleteModal.hidden = true;
        deleteTarget = null;
    }

    // =========================================
    // STORAGE
    // =========================================

    async function getPhotoUrl(path) {
        if (!path) return null;

        const cached = urlCache.get(path);

        if (cached && cached.expires > Date.now()) {
            return cached.url;
        }

        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(path, SIGNED_URL_SECONDS);

        if (error) throw error;

        urlCache.set(path, {
            url: data.signedUrl,
            // refresh a few minutes before the link actually expires
            expires: Date.now() + (SIGNED_URL_SECONDS - 300) * 1000
        });

        return data.signedUrl;
    }

    async function uploadPhoto(file) {
        if (!file) return null;

        const extension = file.type === "image/jpeg"
            ? "jpg"
            : file.type === "image/png"
                ? "png"
                : "webp";

        const filePath = `${supplierId}/${crypto.randomUUID()}.${extension}`;

        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, file, {
                cacheControl: "3600",
                contentType: file.type,
                upsert: false
            });

        if (error) throw error;

        return data.path;
    }

    async function deletePhoto(path) {
        if (!path) return;

        urlCache.delete(path);

        const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([path]);

        if (error) {
            console.error("Photo cleanup error:", error);
        }
    }

    // =========================================
    // LOAD & RENDER
    // =========================================

    async function loadProducts() {
        list.innerHTML = `
            <div class="page-loading">
                ${icon("spinner")} Loading products...
            </div>
        `;

        const { data, error } = await supabase
            .from("supplier_product_listings")
            .select(`
                product_listing_id,
                supplier_id,
                product_name,
                description,
                price,
                stock_quantity,
                unit,
                photo_path,
                created_at,
                updated_at
            `)
            .eq("supplier_id", supplierId)
            .order("created_at", { ascending: false });

        if (error) throw error;

        products = data || [];

        renderProducts();
    }

    function renderProducts() {
        const query = search.value.trim().toLowerCase();

        const filtered = products.filter(product =>
            [
                product.product_name,
                product.description,
                product.unit
            ].some(value =>
                String(value || "").toLowerCase().includes(query)
            )
        );

        if (!filtered.length) {
            list.innerHTML = `
                <div class="empty-state">
                    ${icon("box")}
                    <p>
                        ${products.length
                    ? "No matching products found."
                    : "You have not listed any products yet."}
                    </p>
                </div>
            `;
            return;
        }

        list.innerHTML = `
            <div class="supplier-product-grid">
                ${filtered.map(product => `
                    <article class="supplier-product-card"
                        data-product-id="${safe(product.product_listing_id)}">

                        <div class="product-photo" data-photo-container>
                            ${icon("box")}
                        </div>

                        <div class="product-information">
                            <h3>${safe(product.product_name)}</h3>

                            <span>${formatPrice(product.price)}</span>

                            <span>
                                Stock: ${safe(product.stock_quantity)}
                                ${safe(product.unit || "")}
                            </span>

                            <small>
                                ${safe(product.description || "No description")}
                            </small>
                        </div>

                        <div class="product-actions">
                            <button
                                type="button"
                                class="secondary-button edit-product"
                                data-id="${safe(product.product_listing_id)}"
                            >
                                ${icon("pen")}
                                <span>Edit</span>
                            </button>

                            <button
                                type="button"
                                class="danger-button delete-product"
                                data-id="${safe(product.product_listing_id)}"
                            >
                                ${icon("trash")}
                                <span>Delete</span>
                            </button>
                        </div>
                    </article>
                `).join("")}
            </div>
        `;

        loadProductImages(filtered);
    }

    async function loadProductImages(items) {
        await Promise.all(items.map(async product => {
            if (!product.photo_path) return;

            const card = list.querySelector(
                `[data-product-id="${CSS.escape(String(product.product_listing_id))}"]`
            );

            const container = card?.querySelector("[data-photo-container]");

            if (!container) return;

            try {
                const imageUrl = await getPhotoUrl(product.photo_path);

                if (!container.isConnected) return;

                container.innerHTML = `
                    <img
                        src="${safe(imageUrl)}"
                        alt="${safe(product.product_name)}"
                        loading="lazy"
                    />
                `;
            } catch (error) {
                console.error("Product image loading error:", error);
            }
        }));
    }

    // =========================================
    // ADD / EDIT MODAL
    // =========================================

    function openAddModal() {
        resetProductForm();

        $("#productModalTitle").textContent = "Add Product";
        $("#productModalDescription").textContent =
            "Enter your product information.";

        setSaveButtonState(false);

        modal.hidden = false;
        $("#productName").focus();
    }

    async function openEditModal(productId) {
        const product = products.find(
            item => String(item.product_listing_id) === String(productId)
        );

        if (!product) return;

        resetProductForm();

        editingProductId = product.product_listing_id;
        currentPhotoPath = product.photo_path || null;
        originalPhotoPath = product.photo_path || null;

        $("#productModalTitle").textContent = "Edit Product";
        $("#productModalDescription").textContent =
            "Update your product information.";

        $("#productName").value = product.product_name || "";
        $("#productDescription").value = product.description || "";
        $("#productPrice").value = product.price ?? 0;
        $("#productStock").value = product.stock_quantity ?? 0;
        $("#productUnit").value = product.unit || "";

        setSaveButtonState(false);

        modal.hidden = false;
        $("#productName").focus();

        if (product.photo_path) {
            try {
                const imageUrl = await getPhotoUrl(product.photo_path);

                // ignore if the modal was closed or switched meanwhile
                if (editingProductId !== product.product_listing_id) return;
                if (!currentPhotoPath || selectedPhoto) return;

                showPhotoPreview(imageUrl);
            } catch (error) {
                console.error("Existing photo loading error:", error);
            }
        }
    }

    function closeProductModal() {
        if (isSaving) return;

        modal.hidden = true;
        resetProductForm();
    }

    function validateForm() {
        const name = $("#productName").value.trim();
        const price = Number($("#productPrice").value);
        const stock = Number($("#productStock").value);

        if (!name) {
            throw new Error("Product name is required.");
        }

        if (!Number.isFinite(price) || price < 0) {
            throw new Error("Enter a valid product price.");
        }

        if (!Number.isFinite(stock) || stock < 0) {
            throw new Error("Enter a valid stock quantity.");
        }

        if (selectedPhoto) {
            if (!ALLOWED_TYPES.includes(selectedPhoto.type)) {
                throw new Error("Only JPG, PNG and WEBP images are allowed.");
            }

            if (selectedPhoto.size > MAX_FILE_SIZE) {
                throw new Error("Product photo must not exceed 3 MB.");
            }
        }

        return {
            product_name: name,
            description: $("#productDescription").value.trim() || null,
            price,
            stock_quantity: stock,
            unit: $("#productUnit").value.trim() || null
        };
    }

    async function saveProduct(event) {
        event.preventDefault();

        if (isSaving) return;

        clearError();

        const wasEditing = Boolean(editingProductId);
        const productId = editingProductId;
        const photoToReplace = originalPhotoPath;

        let uploadedPath = null;
        let saved = false;

        try {
            const productData = validateForm();

            isSaving = true;
            setSaveButtonState(true);

            if (selectedPhoto) {
                uploadedPath = await uploadPhoto(selectedPhoto);
                productData.photo_path = uploadedPath;
            } else if (wasEditing && !currentPhotoPath) {
                // the existing photo was removed and not replaced
                productData.photo_path = null;
            }

            if (wasEditing) {
                const { error } = await supabase
                    .from("supplier_product_listings")
                    .update({
                        ...productData,
                        updated_at: new Date().toISOString()
                    })
                    .eq("product_listing_id", productId)
                    .eq("supplier_id", supplierId);

                if (error) throw error;

                // old file is no longer used (replaced or removed)
                if (photoToReplace && (uploadedPath || !currentPhotoPath)) {
                    await deletePhoto(photoToReplace);
                }
            } else {
                const { error } = await supabase
                    .from("supplier_product_listings")
                    .insert({
                        ...productData,
                        supplier_id: supplierId
                    });

                if (error) throw error;
            }

            saved = true;

            modal.hidden = true;
            resetProductForm();

        } catch (error) {
            console.error("Save product error:", error);

            if (uploadedPath) {
                await deletePhoto(uploadedPath);
            }

            showError(error.message || "Unable to save product.");

        } finally {
            isSaving = false;
            setSaveButtonState(false);
        }

        if (!saved) return;

        try {
            await loadProducts();
        } catch (error) {
            console.error("Product reload error:", error);
        }

        alert(`Product ${wasEditing ? "updated" : "added"} successfully.`);
    }

    // =========================================
    // DELETE
    // =========================================

    function openDeleteModal(productId) {
        const product = products.find(
            item => String(item.product_listing_id) === String(productId)
        );

        if (!product) return;

        deleteTarget = product;

        deleteMessage.textContent =
            `Delete "${product.product_name}"? This action cannot be undone.`;

        deleteModal.hidden = false;
    }

    async function deleteProduct() {
        if (!deleteTarget) return;

        const product = deleteTarget;

        confirmDeleteButton.disabled = true;
        confirmDeleteButton.innerHTML = `${icon("spinner")} Deleting...`;

        let deleted = false;

        try {
            const { error } = await supabase
                .from("supplier_product_listings")
                .delete()
                .eq("product_listing_id", product.product_listing_id)
                .eq("supplier_id", supplierId);

            if (error) throw error;

            if (product.photo_path) {
                await deletePhoto(product.photo_path);
            }

            deleted = true;
            closeDeleteModal();

        } catch (error) {
            console.error("Delete product error:", error);
            alert(error.message || "Unable to delete product.");

        } finally {
            confirmDeleteButton.disabled = false;
            confirmDeleteButton.innerHTML = `${icon("trash")} Delete Product`;
        }

        if (!deleted) return;

        try {
            await loadProducts();
        } catch (error) {
            console.error("Product reload error:", error);
        }

        alert("Product deleted successfully.");
    }

    // =========================================
    // EVENT LISTENERS
    // =========================================

    $("#addProductBtn").addEventListener("click", openAddModal);
    $("#closeProductModal").addEventListener("click", closeProductModal);
    $("#cancelProductBtn").addEventListener("click", closeProductModal);

    modal.addEventListener("click", event => {
        if (event.target === modal) closeProductModal();
    });

    $("#closeDeleteModal").addEventListener("click", closeDeleteModal);
    $("#cancelDeleteBtn").addEventListener("click", closeDeleteModal);

    deleteModal.addEventListener("click", event => {
        if (event.target === deleteModal) closeDeleteModal();
    });

    confirmDeleteButton.addEventListener("click", deleteProduct);

    view.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;

        if (!deleteModal.hidden) closeDeleteModal();
        else if (!modal.hidden) closeProductModal();
    });

    search.addEventListener("input", renderProducts);

    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];

        // file dialog cancelled: fall back to the photo that is kept
        if (!file) {
            selectedPhoto = null;

            if (currentPhotoPath) {
                getPhotoUrl(currentPhotoPath)
                    .then(showPhotoPreview)
                    .catch(error => console.error(error));
            } else {
                hidePhotoPreview();
            }

            return;
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            fileInput.value = "";
            selectedPhoto = null;
            showError("Only JPG, PNG and WEBP images are allowed.");
            return;
        }

        if (file.size > MAX_FILE_SIZE) {
            fileInput.value = "";
            selectedPhoto = null;
            showError("Product photo must not exceed 3 MB.");
            return;
        }

        clearError();

        selectedPhoto = file;

        clearPreviewObjectUrl();
        previewObjectUrl = URL.createObjectURL(file);
        previewImage.src = previewObjectUrl;
        previewContainer.hidden = false;
    });

    $("#removeProductPhoto").addEventListener("click", () => {
        selectedPhoto = null;
        fileInput.value = "";
        currentPhotoPath = null; // saving will clear photo_path in the database

        hidePhotoPreview();
    });

    form.addEventListener("submit", saveProduct);

    list.addEventListener("click", async event => {
        const editButton = event.target.closest(".edit-product");
        const deleteButton = event.target.closest(".delete-product");

        if (editButton) {
            await openEditModal(editButton.dataset.id);
            return;
        }

        if (deleteButton) {
            openDeleteModal(deleteButton.dataset.id);
        }
    });

    // =========================================
    // INITIAL LOAD
    // =========================================

    try {
        await loadProducts();

    } catch (error) {
        console.error("Product loading error:", error);

        list.innerHTML = `
            <div class="page-error">
                <p>${safe(error.message)}</p>
            </div>
        `;
    }
}