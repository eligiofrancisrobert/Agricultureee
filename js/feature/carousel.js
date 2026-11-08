const track = document.querySelector('.carousel-track');
const slides = document.querySelectorAll('.about-image');
const prevBtn = document.querySelector('.carousel-btn.prev');
const nextBtn = document.querySelector('.carousel-btn.next');
const dots = document.querySelectorAll('.dot');
const menuIcon = document.getElementById("menu-icon");
const navigations = document.querySelector(".navigations");

let currentIndex = 0;

// Toggle the mobile navigation and keep the primary call-to-action outside it.
menuIcon.addEventListener("click", () => {
    navigations.classList.toggle("active");

    menuIcon.classList.toggle("fa-bars");
    menuIcon.classList.toggle("fa-xmark");

    // Exclude Get Started from the dropdown
    document.querySelectorAll(".navigations a:not(#get-started)")
        .forEach(link => {
            link.style.display = navigations.classList.contains("active")
                ? "block"
                : "none";
        });
});

/** Synchronize the carousel offset and active pagination dot with currentIndex. */
function updateCarousel() {
    track.style.transform = `translateX(-${currentIndex * 100}%)`;

    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentIndex);
    });
}

// Both arrow controls wrap around at the ends of the slide list.
nextBtn.addEventListener('click', () => {
    currentIndex++;

    if (currentIndex >= slides.length) {
        currentIndex = 0;
    }

    updateCarousel();
});

prevBtn.addEventListener('click', () => {
    currentIndex--;

    if (currentIndex < 0) {
        currentIndex = slides.length - 1;
    }

    updateCarousel();
});

dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
        currentIndex = index;
        updateCarousel();
    });
});


setInterval(() => {
    currentIndex++;

    if (currentIndex >= slides.length) {
        currentIndex = 0;
    }

    updateCarousel();
}, 3000);

