
import { h, toast, pageHead } from '../ui.js';
import { supabase } from '../../connection.js';

export async function render(root) {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
        root.append(
            pageHead('Account Settings', 'Manage your administrator account information.'),
            h('p', { class: 'msg error' }, 'Unable to load your account information.')
        );
        return;
    }

    const emailInput = h('input', {
        type: 'email',
        value: user.email || '',
        disabled: true,
        'aria-label': 'Account email'
    });

    const userIdInput = h('input', {
        type: 'text',
        value: user.id,
        disabled: true,
        'aria-label': 'User ID'
    });

    const createdInput = h('input', {
        type: 'text',
        value: user.created_at
            ? new Date(user.created_at).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
            : 'Not available',
        disabled: true,
        'aria-label': 'Account creation date'
    });

    const field = (label, input, hint = '') => h(
        'div',
        { class: 'settings-field' },
        h('label', {}, label),
        input,
        ...(hint ? [h('small', {}, hint)] : [])
    );

    root.append(
        pageHead(
            'Account Settings',
            'View your administrator account information.'
        ),
        h('section', { class: 'card settings-card' },
            h('div', { class: 'settings-card-header' },
                h('h3', {}, 'Administrator Information'),
                h('p', { class: 'muted' }, 'Your account details currently registered in Tanikala.')
            ),
            h('div', { class: 'settings-form-grid' },
                field('Email Address', emailInput, 'Your registered login email address.'),
                field('User ID', userIdInput, 'Your unique authentication account identifier.'),
                field('Account Created', createdInput)
            )
        )
    );
}
