import { h, badge, fmtDate, toast, ROLE, presence, lastLogin } from './ui.js';
import { getApplicantDetails, listDocuments, getDocumentUrl } from './api.js';

const field = ([label, value]) =>
    h('div', { class: 'field' },
        h('small', {}, label),
        value instanceof Node ? value : h('b', {}, value === null || value === undefined || value === '' ? '—' : String(value)));

/** Create a document row whose button requests a temporary viewing URL. */
function docRow(doc) {
    const btn = h('button', { class: 'btn ghost', type: 'button' }, 'View document');
    btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = 'Preparing document...';
        try {
            const url = await getDocumentUrl(doc.id);
            if (!window.open(url, '_blank', 'noopener,noreferrer')) {
                toast('The browser blocked the new tab. Allow pop-ups and try again.');
            }
        } catch (err) {
            console.error('Document viewing failed:', err);
            toast('Could not open the document. Check the browser console.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'View document';
        }
    });
    return h('div', { class: 'doc' },
        h('span', {}, `${String(doc.document_type ?? 'Document').replaceAll('_', ' ')} (${doc.review_status ?? 'Unknown'})`), btn);
}

/**
 * Open an applicant detail dialog and load role-specific details and documents.
 * @param {object} app Applicant profile normalized by the admin API.
 * @param {(status: string) => Promise<void>} [onDecide] Optional approval callback.
 */
export function openDetails(app, onDecide) {
    document.getElementById('detailsDialog')?.remove();

    const extra = h('div', { class: 'fields' }, h('p', { class: 'muted' }, 'Loading...'));
    const docs = h('div', {}, h('p', { class: 'muted' }, 'Loading documents...'));

    const decide = (status) => async () => { await onDecide(status); dialog.close(); };

    const dialog = h('dialog', { id: 'detailsDialog', class: 'details', 'aria-label': 'Application details' },
        h('div', { class: 'card-head' },
            h('h2', {}, 'Application details'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => dialog.close() }, 'Close')),
        h('h3', {}, 'Personal information'),
        h('div', { class: 'fields' }, [
            ['Full name', app.full_name || app.name],
            ['First name', app.first_name],
            ['Middle name', app.middle_name],
            ['Surname', app.surname],
            ['Suffix', app.suffix],
            ['Email', app.email],
            ['Phone', app.phone],
            ['Residential address', app.residential_address],
            ['Role', ROLE[app.role]?.label.slice(0, -1) ?? app.role],
            ['Status', badge(app.status)],
            ['Date submitted', fmtDate(app.joined)],
            ['Last login', lastLogin(app)],
            ['Presence', presence(app)],
        ].map(field)),
        h('h3', {}, 'Additional information'), extra,
        h('h3', {}, 'Registration documents'), docs,
        onDecide && app.status === 'pending'
            ? h('div', { class: 'toolbar' },
                h('button', { class: 'btn', type: 'button', onclick: decide('active') }, 'Approve'),
                h('button', { class: 'btn danger', type: 'button', onclick: decide('rejected') }, 'Reject'))
            : null);

    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal();

    getApplicantDetails(app)
        .then((rows) => extra.replaceChildren(...(rows.length ? rows.map(field) : [h('p', { class: 'muted' }, 'No extra details for this role.')])))
        .catch((err) => {
            console.error('Failed to load applicant details:', err);
            extra.replaceChildren(h('p', { class: 'msg error' }, 'Some additional information could not be loaded. Check the browser console and Supabase permissions.'));
        });

    listDocuments(app.id)
        .then((list) => docs.replaceChildren(...(list.length ? list.map(docRow) : [h('p', { class: 'muted' }, 'No registration documents found for this applicant.')])))
        .catch((err) => {
            console.error('Failed to load registration documents:', err);
            docs.replaceChildren(h('p', { class: 'msg error' }, 'Could not load documents. Check the browser console and Edge Function logs.'));
        });
}