
import { h } from './ui.js';

const SECTIONS = [
    {
        id: 'account',
        label: 'Account',
        description: 'Manage administrator account information.',
        module: './settings/account.js'
    },
    {
        id: 'security',
        label: 'Security',
        description: 'Manage password and security options.',
        module: './settings/security.js'
    },
    {
        id: 'registration',
        label: 'Registration',
        description: 'Manage account registration and approval.',
        module: './settings/registration.js'
    },
    {
        id: 'permissions',
        label: 'Roles & Permissions',
        description: 'Manage system roles and access permissions.',
        module: './settings/permissions.js'
    },
    {
        id: 'notifications',
        label: 'Notifications',
        description: 'Manage system notification preferences.',
        module: './settings/notifications.js'
    },
    {
        id: 'system',
        label: 'System',
        description: 'Manage general system configuration.',
        module: './settings/system.js'
    },
    {
        id: 'audit-logs',
        label: 'Audit Logs',
        description: 'Review system activity and audit records.',
        module: './settings/audit-logs.js'
    },
    {
        id: 'data-management',
        label: 'Data Management',
        description: 'Manage system data and backups.',
        module: './settings/data-management.js'
    }
];

export async function render(root) {
    let activeSection = 'registration';

    const content = h('div', {
        class: 'settings-content'
    });

    const navigation = h('nav', {
        class: 'settings-navigation',
        'aria-label': 'Settings sections'
    });

    const loadSection = async (sectionId) => {
        const section = SECTIONS.find(item => item.id === sectionId);

        if (!section) return;

        activeSection = sectionId;

        navigation.querySelectorAll('button').forEach(button => {
            const active = button.dataset.section === activeSection;

            button.classList.toggle('active', active);
            button.setAttribute('aria-current', active ? 'page' : 'false');
        });

        content.replaceChildren(
            h('p', { class: 'muted' }, 'Loading settings...')
        );

        try {
            const module = await import(section.module);

            content.replaceChildren();
            await module.render(content);
        } catch (error) {
            console.error('Failed to load settings section:', error);

            content.replaceChildren(
                h(
                    'p',
                    { class: 'msg error' },
                    'Unable to load this settings section. Check the browser console.'
                )
            );
        }
    };

    SECTIONS.forEach(section => {
        const button = h(
            'button',
            {
                type: 'button',
                class: 'settings-nav-item',
                dataset: { section: section.id },
                onclick: () => loadSection(section.id)
            },
            h('span', {}, section.label),
            h('small', {}, section.description)
        );

        navigation.append(button);
    });

    root.append(
        h(
            'div',
            { class: 'settings-page' },
            h(
                'header',
                { class: 'settings-header' },
                h('h2', {}, 'Settings'),
                h('p', {}, 'Manage your administrator and system preferences.')
            ),
            h(
                'div',
                { class: 'settings-layout' },
                navigation,
                content
            )
        )
    );

    await loadSection(activeSection);
}
