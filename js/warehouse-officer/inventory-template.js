function el(tag, className = '', text = '') {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined && text !== null) {
        node.textContent = text;
    }

    return node;
}

export function renderInventoryPage(
    root,
    {
        title,
        description,
        icon,
        sections = []
    }
) {
    const page = el('section', 'wo-inventory-page');

    const heading = el('div', 'wo-page-heading');

    heading.append(
        el('h1', '', title),
        el('p', 'muted', description)
    );

    const notice = el('div', 'wo-inventory-notice');

    notice.append(
        el('span', 'wo-inventory-notice-icon', icon || '📦'),
        el(
            'p',
            '',
            'Inventory database integration is pending confirmation of the inventory table structure.'
        )
    );

    const summaryGrid = el('div', 'wo-stats-grid');

    sections.forEach(section => {
        const card = el('article', 'wo-stat-card');

        card.append(
            el('span', 'wo-stat-label', section.label),
            el('strong', 'wo-stat-value', '—'),
            el('small', 'wo-stat-description', 'Awaiting database integration')
        );

        summaryGrid.append(card);
    });

    const content = el('div', 'wo-inventory-content');

    content.append(
        el('h2', '', `${title} Overview`),
        el(
            'p',
            'muted',
            'The inventory interface is prepared. Stock information will appear here once the database tables and fields are connected.'
        )
    );

    page.append(
        heading,
        notice,
        summaryGrid,
        content
    );

    root.replaceChildren(page);
}

export function cleanupInventoryPage() {}