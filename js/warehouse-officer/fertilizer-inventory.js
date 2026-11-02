import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

export function render(root) {
    renderInventoryPage(root, {
        title: 'Fertilizer Inventory',
        description: 'Monitor fertilizer stocks, quantities, and availability.',
        icon: '🌱',
        sections: [
            { label: 'Total Fertilizer Types' },
            { label: 'Available Stock' },
            { label: 'Low Stock Items' },
            { label: 'Out of Stock' }
        ]
    });
}

export function cleanup() {
    cleanupInventoryPage();
}