import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

export function render(root) {
    renderInventoryPage(root, {
        title: 'Pesticide Inventory',
        description: 'Monitor pesticide stocks, quantities, and availability.',
        icon: '🧪',
        sections: [
            { label: 'Total Pesticide Types' },
            { label: 'Available Stock' },
            { label: 'Low Stock Items' },
            { label: 'Out of Stock' }
        ]
    });
}

export function cleanup() {
    cleanupInventoryPage();
}