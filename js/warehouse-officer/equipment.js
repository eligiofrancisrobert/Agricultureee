import {
    renderInventoryPage,
    cleanupInventoryPage
} from './inventory-template.js';

export function render(root) {
    renderInventoryPage(root, {
        title: 'Equipment',
        description: 'Monitor agricultural equipment and its current availability.',
        icon: '🚜',
        sections: [
            { label: 'Total Equipment' },
            { label: 'Available Equipment' },
            { label: 'Equipment In Use' },
            { label: 'Under Maintenance' }
        ]
    });
}

export function cleanup() {
    cleanupInventoryPage();
}