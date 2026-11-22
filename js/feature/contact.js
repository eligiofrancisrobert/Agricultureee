
const contactForm = document.getElementById("contactForm");

if (contactForm) {
    const submitButton = contactForm.querySelector(".contact-submit");

    // ---------- CONTACT MODAL ----------

    function createContactModal() {
        if (document.getElementById("contactFeedbackModal")) return;

        const modal = document.createElement("div");
        modal.id = "contactFeedbackModal";
        modal.className = "contact-feedback-modal";
        modal.setAttribute("aria-hidden", "true");

        modal.innerHTML = `
            <div class="contact-feedback-backdrop"></div>

            <div class="contact-feedback-content"
                 role="dialog"
                 aria-modal="true"
                 aria-labelledby="contactFeedbackTitle">

                <div class="contact-feedback-icon" id="contactFeedbackIcon">
                    <i class="fa-solid fa-check"></i>
                </div>

                <h3 id="contactFeedbackTitle">Message Received!</h3>

                <p id="contactFeedbackMessage">
                    Thank you for contacting Tanikala.
                </p>

                <button type="button" id="contactFeedbackClose">
                    Continue
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        const closeModal = () => {
            modal.classList.remove("show");
            modal.setAttribute("aria-hidden", "true");
        };

        modal.querySelector(".contact-feedback-backdrop")
            .addEventListener("click", closeModal);

        modal.querySelector("#contactFeedbackClose")
            .addEventListener("click", closeModal);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && modal.classList.contains("show")) {
                closeModal();
            }
        });
    }

    function showContactModal(type, message) {
        createContactModal();

        const modal = document.getElementById("contactFeedbackModal");
        const icon = document.getElementById("contactFeedbackIcon");
        const title = document.getElementById("contactFeedbackTitle");
        const description = document.getElementById("contactFeedbackMessage");

        if (type === "success") {
            icon.innerHTML = '<i class="fa-solid fa-check"></i>';
            icon.className = "contact-feedback-icon success";
            title.textContent = "Message Received!";
        } else {
            icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            icon.className = "contact-feedback-icon error";
            title.textContent = "Submission Failed";
        }

        description.textContent = message;

        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
    }

    // ---------- SUBMIT CONTACT FORM ----------

    contactForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = {
            name: contactForm.querySelector("#name").value.trim(),
            email: contactForm.querySelector("#email").value.trim(),
            subject: contactForm.querySelector("#subject").value.trim(),
            message: contactForm.querySelector("#message").value.trim(),
        };

        if (!contactForm.reportValidity()) return;

        const originalButtonText = submitButton.innerHTML;

        submitButton.disabled = true;
        submitButton.textContent = "Sending...";

        try {
            const response = await fetch(
                "https://atatxxwupdohxznwilak.supabase.co/functions/v1/send-contact-message",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXR4eHd1cGRvaHh6bndpbGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzODgxNzIsImV4cCI6MjEwNjk2NDE3Mn0.swFWAGG9r7V22Dppt_Rfy1spUK48JXt3XaBdBZIwY5g",
                        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXR4eHd1cGRvaHh6bndpbGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzODgxNzIsImV4cCI6MjEwNjk2NDE3Mn0.swFWAGG9r7V22Dppt_Rfy1spUK48JXt3XaBdBZIwY5g",
                    },
                    body: JSON.stringify(formData),
                }
            );

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(
                    result.error || "Failed to submit your message."
                );
            }

            contactForm.reset();

            showContactModal(
                "success",
                "Thank you for contacting Tanikala! Your inquiry has been received. Our team will review your message and respond as soon as possible."
            );

        } catch (error) {
            console.error("Contact form error:", error);

            showContactModal(
                "error",
                error.message || "Unable to submit your message. Please try again."
            );

        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    });
}
