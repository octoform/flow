<script>
  import { onMount } from 'svelte';
  import { parseState, readSession, writeSession } from '$lib/flow';

  let code = '';
  let statePayload = null;
  let session = null;
  let error = '';
  let returnHref = '/';
  let ready = false;

  onMount(() => {
    try {
      const url = new URL(window.location.href);
      code = url.searchParams.get('code') ?? '';
      statePayload = parseState(url.searchParams.get('state') ?? '');

      if (!code) {
        error = 'Missing `code` in the callback URL.';
        return;
      }

      if (!statePayload?.sessionId || !statePayload?.appKey) {
        error = 'Missing or invalid callback `state`.';
        return;
      }

      session = writeSession(statePayload.sessionId, (record) => ({
        ...record,
        sessionId: statePayload.sessionId,
        updatedAt: new Date().toISOString(),
        codes: {
          ...(record.codes || {}),
          [statePayload.appKey]: {
            code,
            receivedAt: new Date().toISOString()
          }
        }
      }));

      returnHref = session.sourceUrl || readSession(statePayload.sessionId).sourceUrl || '/';
    } catch (caughtError) {
      error = caughtError instanceof Error ? caughtError.message : 'Unexpected callback handling error.';
    } finally {
      ready = true;
    }
  });
</script>

<svelte:head>
  <title>Octoform Flow Return</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page-shell">
  <section class="hero">
    <span class="eyebrow">Return Handler</span>
    <h1>Callback received.</h1>
    <p>GitHub redirected back with a temporary manifest conversion code. This page stores it in local browser storage under the active session.</p>
  </section>

  <section class="grid cols-2">
    <article class="card">
      <h2>Status</h2>

      {#if !ready}
        <p class="subtle small">Processing callback data from the URL.</p>
      {:else if error}
        <div class="warning small">{error}</div>
      {:else}
        <div class="success small">Stored code for <code>{statePayload?.appKey}</code> in session <code>{statePayload?.sessionId}</code>.</div>
        <div class="meta-grid">
          <div>
            <p class="meta-label">App key</p>
            <p class="meta-value"><code>{statePayload?.appKey}</code></p>
          </div>
          <div>
            <p class="meta-label">Session ID</p>
            <p class="meta-value"><code>{statePayload?.sessionId}</code></p>
          </div>
        </div>
        <pre class="code-block">{JSON.stringify(session?.codes || {}, null, 2)}</pre>
      {/if}

      <div class="actions">
        <a class="button" href={returnHref}>Back to flow</a>
      </div>
    </article>

    <article class="card">
      <h2>What happens next</h2>
      <ul class="list-reset small subtle">
        <li>The original page refreshes its progress bar whenever the tab regains focus.</li>
        <li>Once all expected callbacks are present, it exposes a clipboard action for the final JSON map.</li>
        <li>The collected values are still temporary manifest conversion codes and need to be exchanged server-side within one hour.</li>
      </ul>
    </article>
  </section>
</div>
