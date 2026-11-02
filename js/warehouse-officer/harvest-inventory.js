import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

export function render(root) {
    renderInventoryPage(root, {
        title: 'Harvest Inventory',
        description: 'View verified harvest records from your assigned farm.',
        icon: '🌾',
        sections: [
            { label: 'Crop Types' },
            { label: 'Total Verified Quantity' },
            { label: 'Available Stock' },
            { label: 'Verified Harvest Records' }
        ]
    });
}

export function cleanup() {
    cleanupInventoryPage();
}