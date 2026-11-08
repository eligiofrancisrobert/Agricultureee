🌾 Tanikala – Agricultural Management Platform

Tanim. Ani. Suplay. Kita.  
From Farm to Market, Managed Smarter.

📖 About the Project

Tanikala is a web-based agricultural platform designed to connect farmers, buyers, and suppliers in one accessible system. It aims to make agricultural operations, supply management, and product distribution simpler and more efficient through digital solutions.

The platform provides a centralized environment where users can explore agricultural services, learn about the system, and access account-related features depending on their roles.

🎯 Objectives

- Connect farmers, buyers, and agricultural suppliers.
- Support more organized agricultural operations.
- Improve agricultural product and supply management.
- Provide a convenient platform for agricultural-related information.
- Promote the use of technology in modern agriculture.

✨ Features

🌱 User and Account Access
- Login and registration pages.
- Support for farmer, buyer, and supplier account types.
- Account-related information and registration guidance.
- Account approval information for applications requiring administrator review.

🚜 Agricultural Platform
- Agricultural services information.
- Farmer and supplier-oriented platform content.
- Information about farm management, crop management, inventory, and supply chain operations.

💻 Website Interface
- Responsive website layout for different screen sizes.
- Homepage with navigation and informational sections.
- About Us and Contact sections.
- Image carousel.
- Light and dark theme toggle.
- Searchable and categorized Frequently Asked Questions (FAQs).

🛠️ Technologies Used

| Technology | Purpose |
|---|---|
| HTML5 | Website structure and content |
| CSS3 | Website styling and responsive layouts |
| JavaScript | Interactive website features |
| Git and GitHub | Version control and project collaboration |

📂 Project Structure

```text
Agricultureee/
│
├── assets/                 # Images, icons, and other media
│
├── css/                    # Stylesheets
│
├── html/                   # Additional website pages
│
├── js/                     # JavaScript functionality
│
├── index.html              # Main homepage
│
└── README.md               # Project documentation
```

*Note: The folders may contain additional subdirectories for organizing individual files and modules.*

🚀 Getting Started

Follow these instructions to run the project locally.

Prerequisites

- A computer running Windows, macOS, or Linux.
- A modern web browser (Google Chrome, Microsoft Edge, or Firefox).
- Visual Studio Code (recommended).
- Live Server extension for Visual Studio Code (recommended).

Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/eligiofrancisrobert/Agricultureee.git
   ```

2. Navigate to the project directory:

   ```bash
   cd Agricultureee
   ```

3. Open the project in Visual Studio Code:

   ```bash
   code .
   ```

4. Install the **Live Server** extension in Visual Studio Code if it is not already installed.

5. Open `index.html`.

6. Right-click the file and select **Open with Live Server**.

7. Your default browser should open the Tanikala homepage.

👥 Supported User Roles

Tanikala identifies three main user roles:

| User Role | Description |
|---|---|
| Farmer | Users involved in agricultural and farming activities. |
| Buyer | Users interested in agricultural products. |
| Supplier | Users who provide agricultural products and supplies. |

Available features depend on the user's role and account access.

🧪 Project Development

Tanikala is an ongoing web development project. Its interface and functionality may change as development continues.

Future improvements may include:
- Further development of farm and crop management features.
- Improved inventory and supply management.
- Enhanced user account management.
- Additional system testing and optimization.
- Improved accessibility and responsiveness.

🤝 Contributing

Contributions, suggestions, and bug reports are welcome.

To contribute:

1. Fork this repository.
2. Create a new branch for your changes.
3. Make your modifications.
4. Test your changes.
5. Submit a Pull Request for review.

📌 Repository

**GitHub:** [eligiofrancisrobert/Agricultureee](https://github.com/eligiofrancisrobert/Agricultureee)

📄 License

No license is currently specified in the repository. Please contact the repository owner for permission before redistributing or reusing the project's code.

---

<p align="center">
  🌾 <strong>Tanikala</strong><br>
  Connecting Farms, Suppliers, and Buyers Through Smarter Agricultural Solutions.
</p>

## Automated testing

The website remains a static HTML/CSS/JavaScript site with hosted Supabase services. Its test suite and CI logic are Python-based (pytest, Playwright for Python, Requests, html5lib, and tinycss2); Node.js is not required to run tests. Browser checks stub third-party services so they never access production accounts or data. They validate client-side behavior, not live authentication or database policies.

### Prerequisites and installation

- Python 3.10 or later.
- Chromium for Playwright browser checks.

```powershell
python -m pip install -r requirements-test.txt
python -m playwright install chromium
```

On GitHub Actions, install the browser and operating-system dependencies with `python -m playwright install --with-deps chromium`.

### Commands

| Purpose | Command |
|---|---|
| Run the full suite (starts an isolated local server when needed) | `python -m pytest` |
| Run the full suite through the convenience script | `python scripts/run_tests.py` |
| Run functional browser tests only | `python -m pytest -m functional` |
| Run responsive checks only | `python -m pytest -m responsive` |
| Start a test-owned server, run tests, and shut it down | `python scripts/start_and_test.py` |
| Test an already-running local server | `python scripts/runtime_test.py --url http://127.0.0.1:5500` |
| Test a staging/production deployment | `python scripts/deployment_test.py --url https://example.com` |
| Run pytest and generate HTML, JUnit, and coverage reports | `python -m pytest` |

PowerShell examples:

```powershell
$env:BASE_URL = "http://127.0.0.1:5500"
python -m pytest
Remove-Item Env:BASE_URL
```

`python -m pytest` starts a temporary server on an ephemeral port when `BASE_URL` is not set; it stops only that test-owned server. Set `BASE_URL` to test VS Code Live Server, Python HTTP server, another local server, or staging. `runtime_test.py` and `deployment_test.py` never start or stop the target server. The runtime script fails with a connection diagnostic if the configured site does not respond.

pytest writes an HTML report to `reports/report.html`, JUnit XML to `reports/junit.xml`, and Python test-harness coverage to `reports/coverage.xml`. This coverage measures the Python testing utilities, not the browser-executed website JavaScript. Browser failure screenshots are saved in `test-results/screenshots/`.

The Python CI workflow in `.github/workflows/python-ci.yml` installs the requirements and Chromium, runs the same Python test suite on pushes to `main`, pull requests, manual runs, and a weekly schedule, and uploads reports and browser failure evidence. A hosting pipeline can run `python -m pip install -r requirements-test.txt`, `python -m playwright install chromium`, then `python scripts/deployment_test.py --url https://your-deployment.example` after deployment. No deployment platform is auto-detected or modified; the smoke tests are read-only.
