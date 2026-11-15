
import { h, toast, pageHead } from '../ui.js';
import { supabase } from '../../connection.js';

export async function render(root) {
    const passwordInput = h('input', {
        type: 'password',
        name: 'password',
        placeholder: 'Enter new password',
        required: true,
        minlength: 8,
        autocomplete: 'new-password'
    });

    const confirmInput = h('input', {
        type: 'password',
        name: 'confirmPassword',
        placeholder: 'Confirm new password',
        required: true,
        minlength: 8,
        autocomplete: 'new-password'
    });

    const field = (label, input, hint = '') => h(
        'div',
        { class: 'settings-field' },
        h('label', {}, label),
        input,
        ...(hint ? [h('small', {}, hint)] : [])
    );

    const form = h('form', {
        onsubmit: async (event) => {
            event.preventDefault();

            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton.disabled) return;

            const password = passwordInput.value;
            const confirmation = confirmInput.value;

            if (password.length < 8) {
                toast('Password must contain at least 8 characters.');
                return;
            }

            if (password !== confirmation) {
                toast('Passwords do not match.');
                confirmInput.focus();
                return;
            }

            submitButton.disabled = true;
            submitButton.textContent = 'Updating...';

            try {
                const { error } = await supabase.auth.updateUser({
                    password
                });

                if (error) throw error;

                form.reset();
                toast('Password updated successfully.');
            } catch (error) {
                console.error('Password update failed:', error);
                toast(error.message || 'Unable to update password.');
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = 'Update password';
            }
        }
    },
        field('New Password', passwordInput, 'Use at least 8 characters.'),
        field('Confirm New Password', confirmInput),
        h('div', { class: 'save-row' },
            h('button', {
                class: 'btn',
                type: 'submit'
            }, 'Update password')
        )
    );

    root.append(
        pageHead(
            'Security Settings',
            'Manage your administrator password and account security.'
        ),
        h('section', { class: 'card settings-card' },
            h('div', { class: 'settings-card-header' },
                h('h3', {}, 'Change Password'),
                h('p', { class: 'muted' }, 'Update your password to help protect your administrator account.')
            ),
            form
        )
    );
}
