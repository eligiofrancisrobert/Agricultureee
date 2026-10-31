const contactForm = document.getElementById("contactForm");

contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = contactForm.querySelector(".contact-submit");
    const originalButtonText = submitButton.innerHTML;

    const formData = {
        name: contactForm.querySelector("#name").value.trim(),
        email: contactForm.querySelector("#email").value.trim(),
        subject: contactForm.querySelector("#subject").value.trim(),
        message: contactForm.querySelector("#message").value.trim(),
    };

    if (!contactForm.reportValidity()) return;

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
                },
                body: JSON.stringify(formData),
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Failed to send message.");
        }

        alert("Thank you! Your message has been sent to Tanikala.");
        contactForm.reset();
    } catch (error) {
        console.error("Contact form error:", error);
        alert(error.message || "Unable to send your message. Please try again.");
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonText;
    }
});
