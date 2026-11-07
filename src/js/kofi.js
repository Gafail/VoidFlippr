/* Ko-fi support button.
 *
 * The Ko-fi widget normally renders itself with document.writeln(), which
 * drops it at the end of the document - below the fold on this layout.
 * We load the widget ourselves and inject its markup into a container
 * instead, so it sits inline with the page.
 *
 * The widget ships its own stylesheet with !important rules that fight the
 * site's button styles. The overrides below retheme it to match.
 */

const WIDGET_SRC = 'https://storage.ko-fi.com/cdn/widget/Widget_2.js';
const KOFI_USERNAME = 'R5E3224KOP';
const KOFI_COLOR = '#72a4f2';
const KOFI_LABEL = 'Support me on Ko-fi';

let started = false;

function render(container) {
    const widget = window.kofiwidget2;
    if (!widget || !container) return;

    widget.init(KOFI_LABEL, KOFI_COLOR, KOFI_USERNAME);

    // getHTML() returns the widget's <style> block plus the button markup.
    // The Google Fonts <link> is dropped: the button uses the site font.
    container.innerHTML = widget.getHTML().replace(
        /<link[^>]*fonts\.googleapis[^>]*>/,
        ''
    );
}

/**
 * Load the Ko-fi widget and render it into #kofiSupport.
 *
 * Safe to call more than once, and safe to call when the CDN is blocked:
 * a missing support button must never break the game.
 */
export function loadKofi() {
    if (started) return;
    started = true;

    const container = document.getElementById('kofiSupport');
    if (!container) return;

    // The script may already be present if this runs twice.
    if (window.kofiwidget2) {
        render(container);
        return;
    }

    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.onload = () => render(container);
    script.onerror = () => {
        // Offline or the CDN is blocked - leave the container empty.
    };
    document.head.appendChild(script);
}
