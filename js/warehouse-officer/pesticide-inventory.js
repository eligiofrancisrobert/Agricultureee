
import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

export async function render(root, ctx) {
    await renderInventoryPage(root, {
        title: 'Pesticide Inventory',
        description: 'Monitor pesticide stocks, quantities, and availability.',
        icon: '🧪',
        category: 'Pesticide',
        sections: [
            { label: 'Total Pesticide Types' },
            { label: 'Available Stock' },
            { label: 'Low Stock Items' },
            { label: 'Out of Stock' }
        ]
    }, ctx);
}

export function cleanup() {
    cleanupInventoryPage();
}
