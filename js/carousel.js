const track = document.querySelector('.carousel-track');
const slides = document.querySelectorAll('.about-image');
const prevBtn = document.querySelector('.carousel-btn.prev');
const nextBtn = document.querySelector('.carousel-btn.next');
const dots = document.querySelectorAll('.dot');

let currentIndex = 0;

function updateCarousel() {
    track.style.transform = `translateX(-${currentIndex * 100}%)`;

    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentIndex);
    });
}

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