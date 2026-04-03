<script>
  import { onMount } from 'svelte';
  import {
    buildFlowArtifacts,
    buildState,
    completionStats,
    flowFingerprint,
    getOrCreateSession,
    mapCodes,
    parseFlow,
    readSession,
    writeSession
  } from '$lib/flow';

  let parsedFlow = null;
  let pageErrors = [];
  let warnings = [];
  let manifests = [];
  let actionUrl = '';
  let sessionId = '';
  let session = { codes: {}, labels: {} };
  let stats = { completed: 0, total: 0, done: false };
  let copied = false;
  let copyError = '';
  let encodedResult = '{}';
  let ready = false;

  function refresh() {
    copied = false;
    copyError = '';

    try {
      const currentUrl = new URL(window.location.href);
      parsedFlow = parseFlow(currentUrl);
      pageErrors = [...parsedFlow.errors];

      if (!pageErrors.length) {
        const artifacts = buildFlowArtifacts({ ...parsedFlow, currentUrl });
        pageErrors = [...artifacts.errors];
        warnings = artifacts.warnings;
        manifests = artifacts.manifests;
        actionUrl = artifacts.actionUrl;
      } else {
        warnings = [];
        manifests = [];
        actionUrl = '';
      }

      if (!pageErrors.length) {
        const fingerprint = flowFingerprint(parsedFlow);
        sessionId = getOrCreateSession(fingerprint);

        session = writeSession(sessionId, (record) => ({
          ...record,
          sessionId,
          sourceUrl: `${currentUrl.pathname}${currentUrl.search}`,
          owner: parsedFlow.owner,
          ownerType: parsedFlow.ownerType,
          flowType: parsedFlow.flowType,
          updatedAt: new Date().toISOString(),
          labels: {
            ...(record.labels || {}),
            ...Object.fromEntries(manifests.map((item) => [item.key, item.label]))
          },
          expectedKeys: manifests.map((item) => item.key)
        }));
      } else {
        sessionId = '';
        session = { codes: {}, labels: {} };
      }

      stats = completionStats(session, manifests);
      encodedResult = JSON.stringify(mapCodes(session, manifests), null, 2);
    } catch (error) {
      parsedFlow = null;
      warnings = [];
      manifests = [];
      actionUrl = '';
      sessionId = '';
      session = { codes: {}, labels: {} };
      stats = { completed: 0, total: 0, done: false };
      encodedResult = '{}';
      pageErrors = [error instanceof Error ? error.message : 'Unexpected startup error.'];
    } finally {
      ready = true;
    }
  }

  function syncSession() {
    if (!sessionId) {
      return;
    }

    session = readSession(sessionId);
    stats = completionStats(session, manifests);
    encodedResult = JSON.stringify(mapCodes(session, manifests), null, 2);
  }

  async function copyResult() {
    copied = false;
    copyError = '';

    try {
      await navigator.clipboard.writeText(encodedResult);
      copied = true;
    } catch (error) {
      copyError = error instanceof Error ? error.message : 'Clipboard write failed.';
    }
  }

  function manifestState(item) {
    return buildState({
      sessionId,
      appKey: item.key
    });
  }

  onMount(() => {
    refresh();

    const handleStorage = () => syncSession();
    const handleFocus = () => syncSession();

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
    };
  });
</script>

<svelte:head>
  <title>Octoform Flow</title>
  <meta name="description" content="Static helper UI for GitHub App manifest bootstrap and apply flows." />
</svelte:head>

<div class="page-shell">
  <section class="hero">
    <span class="eyebrow">Octoform Flow</span>
    <h1>Guide the GitHub App manifest dance without losing the codes.</h1>
    <p>
      This page reads your query string, prepares the manifest submissions, tracks the generated
      session automatically, and waits until every callback code has been collected.
    </p>
  </section>

  {#if !ready}
    <section class="card">
      <h2>Preparing flow</h2>
      <p class="subtle small">Reading query parameters and restoring the browser session.</p>
    </section>
  {:else if pageErrors.length}
    <section class="card">
      <h2>Request problem</h2>
      <div class="warning">
        <ul class="list-reset small">
          {#each pageErrors as error}
            <li>{error}</li>
          {/each}
        </ul>
      </div>
      <p class="subtle small">
        Expected query parameters: <code>owner</code>, <code>owner_type</code>, <code>flow_type</code>,
        and <code>payload</code> for apply flows.
      </p>
    </section>
  {:else}
    <section class="grid cols-2">
      <div class="stack">
        <article class="card">
          <h2>Session</h2>
          <div class="meta-grid">
            <div>
              <p class="meta-label">Owner</p>
              <p class="meta-value">{parsedFlow?.owner ?? 'n/a'}</p>
            </div>
            <div>
              <p class="meta-label">Owner type</p>
              <p class="meta-value">{parsedFlow?.ownerType ?? 'n/a'}</p>
            </div>
            <div>
              <p class="meta-label">Flow type</p>
              <p class="meta-value">{parsedFlow?.flowType ?? 'n/a'}</p>
            </div>
            <div>
              <p class="meta-label">Session ID</p>
              <p class="meta-value"><code>{sessionId}</code></p>
            </div>
          </div>
          <div class="note small">
            Each manifest button posts directly to GitHub with a per-app <code>state</code> payload.
            Open them one by one or in parallel. The callback page stores returned codes into this session.
          </div>
          {#if warnings.length}
            <div class="warning small">
              <ul class="list-reset">
                {#each warnings as warning}
                  <li>{warning}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </article>

        <article class="status-card">
          <div class="progress-row">
            <div>
              <h2>Collected codes</h2>
              <p class="subtle small">{stats.completed} of {stats.total} manifest callbacks completed.</p>
            </div>
            {#if stats.done}
              <span class="pill">Ready to copy</span>
            {:else}
              <span class="pill">Waiting for callbacks</span>
            {/if}
          </div>

          <div class="progress-bar" aria-hidden="true">
            <span style={`width: ${stats.total ? (stats.completed / stats.total) * 100 : 0}%`}></span>
          </div>

          <pre class="code-block">{encodedResult}</pre>

          <div class="actions">
            <button class="button" type="button" disabled={!stats.done} on:click={copyResult}>
              Copy app-id to code JSON
            </button>
            <button class="button-secondary" type="button" on:click={syncSession}>Refresh session</button>
          </div>

          {#if copied}
            <div class="success small">Clipboard updated with the collected JSON map.</div>
          {/if}

          {#if copyError}
            <div class="warning small">{copyError}</div>
          {/if}
        </article>
      </div>

      <article class="card">
        <h2>Manifests</h2>
        <div class="manifest-list">
          {#each manifests as item}
            <section class="manifest-card">
              <div class="manifest-top">
                <div class="manifest-name">
                  <h3>{item.label}</h3>
                  <span class="subtle small"><code>{item.key}</code></span>
                </div>
                {#if session.codes?.[item.key]?.code}
                  <span class="pill">Code captured</span>
                {:else}
                  <span class="pill">Pending</span>
                {/if}
              </div>

              {#if item.permissions.length}
                <div>
                  <p class="meta-label">Permissions</p>
                  <div class="pill-row">
                    {#each item.permissions as [name, level]}
                      <span class="pill">{name}: {level}</span>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if item.events.length}
                <div>
                  <p class="meta-label">Events</p>
                  <div class="pill-row">
                    {#each item.events as eventName}
                      <span class="pill">{eventName}</span>
                    {/each}
                  </div>
                </div>
              {/if}

              <form action={`${actionUrl}?state=${encodeURIComponent(manifestState(item))}`} method="post" target="_blank">
                <input type="hidden" name="manifest" value={JSON.stringify(item.manifest)} />
                <div class="actions">
                  <button class="button" type="submit">Create on GitHub</button>
                </div>
              </form>

              <details>
                <summary class="subtle small">Manifest JSON</summary>
                <pre class="code-block">{JSON.stringify(item.manifest, null, 2)}</pre>
              </details>
            </section>
          {/each}
        </div>
      </article>
    </section>
  {/if}
</div>
