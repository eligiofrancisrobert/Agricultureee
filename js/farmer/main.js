import { supabase } from "../connection.js";

const farmerName = document.getElementById("farmerName");
const welcomeName = document.getElementById("welcomeName");
const farmerAvatar = document.getElementById("farmerAvatar");
const logoutButton = document.getElementById("logoutButton");
const themeToggle = document.getElementById("themeToggle");
const todayLabel = document.getElementById("todayLabel");

const logoutDefaultHTML = logoutButton.innerHTML;

let currentUser = null;

/* ============ THEME + DATE (same behavior as Farm Manager) ============ */
todayLabel.textContent = new Date().toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric"
});

themeToggle.addEventListener("click", () => {
    const next =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";

    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
});

/* ============ DASHBOARD ============ */
async function initializeFarmerDashboard() {
    try {
        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError || !user) {
            window.location.replace("../../login.html");
            return;
        }

        currentUser = user;

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, role, status")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (
            !profile ||
            profile.role !== "farmer" ||
            !["active", "approved"].includes(profile.status)
        ) {
            await supabase.auth.signOut();
            window.location.replace("../../login.html");
            return;
        }

        const fullName =
            user.user_metadata?.full_name ||
            user.user_metadata?.fullName ||
            user.email?.split("@")[0] ||
            "Farmer";

        const firstName = fullName.trim().split(/\s+/)[0];

        farmerName.textContent = fullName;
        welcomeName.textContent = firstName;

        farmerAvatar.textContent = firstName.charAt(0).toUpperCase();

    } catch (error) {
        console.error("Farmer dashboard initialization failed:", error);

        document.querySelector(".main-content").innerHTML = `
            <div class="error-message">
                <h2>Unable to load your dashboard</h2>
                <p>Please refresh the page or log in again.</p>
            </div>
        `;
    }
}

async function logout() {
    if (!currentUser || logoutButton.disabled) return;

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {
        const { error } = await supabase.auth.signOut();

        if (error) throw error;

        window.location.replace("../../login.html");

    } catch (error) {
        console.error("Logout failed:", error);

        logoutButton.disabled = false;
        logoutButton.innerHTML = logoutDefaultHTML;

        alert("Unable to log out. Please try again.");
    }
}

logoutButton.addEventListener("click", logout);

document.querySelectorAll("[data-coming-soon]").forEach(link => {
    link.addEventListener("click", event => {
        event.preventDefault();
        alert("This feature is not yet available.");
    });
});

initializeFarmerDashboard();