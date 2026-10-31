
document.addEventListener("DOMContentLoaded", () => {
    const faqRight = document.querySelector(".faq-right");
    if (!faqRight) return;

    const searchInput = document.getElementById("faqSearch");
    const clearSearch = document.getElementById("clearFaqSearch");
    const categoryButtons = document.querySelectorAll(".faq-category");
    const seeMoreButton = document.getElementById("faqSeeMore");
    const emptyMessage = document.getElementById("faqEmpty");
    const resultsText = document.getElementById("faqResults");
    const resetButton = document.getElementById("resetFaq");

    let activeCategory = "all";
    let showAll = false;

    const items = [...faqRight.querySelectorAll(".faq-item")];
    const extraItems = items.filter(item =>
        item.classList.contains("faq-extra")
    );

    // Open one question at a time.
    items.forEach(item => {
        const question = item.querySelector(".faq-question");
        const answer = item.querySelector(".faq-answer");

        if (!question || !answer) return;

        answer.id ||= `faq-answer-${items.indexOf(item) + 1}`;
        question.setAttribute("aria-controls", answer.id);

        question.addEventListener("click", () => {
            const willOpen = !item.classList.contains("open");

            items.forEach(other => {
                other.classList.remove("open");
                other.querySelector(".faq-question")
                    ?.setAttribute("aria-expanded", "false");
            });

            if (willOpen) {
                item.classList.add("open");
                question.setAttribute("aria-expanded", "true");
            }
        });
    });

    function filterFaqs() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        const searching = searchTerm.length > 0;
        let visibleCount = 0;

        clearSearch.hidden = !searching;

        items.forEach(item => {
            const question = item.querySelector(".faq-question");
            const answer = item.querySelector(".faq-answer");
            const category = item.dataset.category || "general";

            const text = `${question?.innerText || ""} ${
                answer?.innerText || ""
            }`.toLowerCase();

            const matchesSearch = !searching || text.includes(searchTerm);
            const matchesCategory =
                activeCategory === "all" || category === activeCategory;

            // Searching should also search the extra questions.
            const isExtra = item.classList.contains("faq-extra");
            const shouldShowExtra = showAll || searching;

            const visible =
                matchesSearch &&
                matchesCategory &&
                (!isExtra || shouldShowExtra);

            item.hidden = !visible;

            if (!visible) {
                item.classList.remove("open");
                question?.setAttribute("aria-expanded", "false");
            } else {
                visibleCount++;
            }
        });

        emptyMessage.hidden = visibleCount !== 0;

        resultsText.textContent = searching || activeCategory !== "all"
            ? `${visibleCount} question${visibleCount === 1 ? "" : "s"} found`
            : "";

        // Hide See More when searching or using a specific category.
        const showMoreAvailable =
            !searching &&
            activeCategory === "all" &&
            extraItems.length > 0;

        seeMoreButton.hidden = !showMoreAvailable;

        seeMoreButton.classList.toggle("expanded", showAll);
        seeMoreButton.innerHTML = showAll
            ? 'See Less <i class="fa-solid fa-chevron-down"></i>'
            : 'See More Questions <i class="fa-solid fa-chevron-down"></i>';
    }

    searchInput.addEventListener("input", filterFaqs);

    clearSearch.addEventListener("click", () => {
        searchInput.value = "";
        filterFaqs();
        searchInput.focus();
    });

    categoryButtons.forEach(button => {
        button.addEventListener("click", () => {
            activeCategory = button.dataset.category;

            categoryButtons.forEach(categoryButton => {
                const isActive = categoryButton === button;
                categoryButton.classList.toggle("active", isActive);
                categoryButton.setAttribute(
                    "aria-pressed",
                    String(isActive)
                );
            });

            filterFaqs();
        });
    });

    seeMoreButton.addEventListener("click", () => {
        showAll = !showAll;
        filterFaqs();
    });

    resetButton.addEventListener("click", () => {
        activeCategory = "all";
        showAll = false;
        searchInput.value = "";

        categoryButtons.forEach(button => {
            const isAll = button.dataset.category === "all";
            button.classList.toggle("active", isAll);
            button.setAttribute("aria-pressed", String(isAll));
        });

        filterFaqs();
    });

    filterFaqs();
});
