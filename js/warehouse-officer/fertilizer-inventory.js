
import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

/** Render fertilizer stock metrics and records through the shared template. */
export async function render(root, ctx) {
    await renderInventoryPage(root, {
        title: 'Fertilizer Inventory',
        description: 'Monitor fertilizer stocks, quantities, and availability.',
        icon: '🌱',
        category: 'Fertilizer',
        sections: [
            { label: 'Total Fertilizer Types' },
            { label: 'Available Stock' },
            { label: 'Low Stock Items' },
            { label: 'Out of Stock' }
        ]
    }, ctx);
}

/** Release shared inventory-page resources before navigating away. */
export function cleanup() {
    cleanupInventoryPage();
}
