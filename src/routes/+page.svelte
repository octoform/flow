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
  let ownerProfile = null;
  let ownerProfileError = '';
  let ownerProfileLoading = false;

  const permissionDescriptions = {
    actions: 'Workflows, workflow runs and workflow artifacts.',
    administration: 'Repository creation, deletion, settings, teams and collaborators.',
    attestations: 'Create and retrieve attestations for a repository.',
    checks: 'Checks on code.',
    contents: 'Repository contents, commits, branches and releases.',
    deployments: 'Deployment statuses and deployment environments.',
    discussions: 'Repository discussions and discussion comments.',
    issues: 'Issues, labels, milestones and comments.',
    metadata: 'Basic repository details and references.',
    pull_requests: 'Pull requests, reviews, review requests and comments.',
    repository_hooks: 'Repository webhook configuration.',
    statuses: 'Commit statuses.'
  };

  const eventDescriptions = {
    check_run: 'Receive updates whenever a check run changes.',
    check_suite: 'Receive updates for grouped checks created for commits.',
    issue_comment: 'Receive comments added to issues and pull requests.',
    issues: 'Receive issue lifecycle events.',
    pull_request: 'Receive pull request lifecycle events.',
    pull_request_review: 'Receive review submissions and review edits.',
    push: 'Receive branch and tag push events.',
    repository: 'Receive repository metadata changes.'
  };

  function refresh() {
    copied = false;
    copyError = '';
    ownerProfile = null;
    ownerProfileError = '';
    ownerProfileLoading = false;

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

  function humanizeKey(value) {
    return String(value)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function permissionSummary(item) {
    const selected = item.permissions.filter(([, level]) => level && level !== 'none').length;
    return `${selected} selected`;
  }

  function permissionDescription(name) {
    return permissionDescriptions[name] || 'GitHub App permission scope.';
  }

  function eventDescription(name) {
    return eventDescriptions[name] || 'Selected webhook event subscription.';
  }

  function accessLabel(level) {
    if (!level || level === 'none') {
      return 'Access: No access';
    }

    if (level === 'read') {
      return 'Access: Read-only';
    }

    if (level === 'write') {
      return 'Access: Read and write';
    }

    return `Access: ${humanizeKey(level)}`;
  }

  async function loadOwnerProfile() {
    if (!parsedFlow?.owner) {
      return;
    }

    ownerProfileLoading = true;
    ownerProfileError = '';

    try {
      const response = await fetch(`https://api.github.com/users/${encodeURIComponent(parsedFlow.owner)}`, {
        headers: {
          Accept: 'application/vnd.github+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub profile lookup failed with ${response.status}.`);
      }

      const data = await response.json();
      ownerProfile = {
        login: data.login || parsedFlow.owner,
        name: data.name || data.login || parsedFlow.owner,
        avatarUrl: data.avatar_url || '',
        htmlUrl: data.html_url || `https://github.com/${parsedFlow.owner}`,
        type: data.type || humanizeKey(parsedFlow.ownerType)
      };
    } catch (error) {
      ownerProfileError = error instanceof Error ? error.message : 'Unable to load owner profile.';
    } finally {
      ownerProfileLoading = false;
    }
  }

  onMount(() => {
    refresh();
    loadOwnerProfile();

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
    <h1>Review GitHub App manifests before sending them to GitHub.</h1>
    <p>
      This page restores the session, shows the target owner first, then lists every app to create in a
      compact GitHub-style form preview.
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
    <div class="stack">
      <article class="card">
        <div class="section-header">
          <h2>Owner</h2>
          <p>The GitHub account below will own the apps created from this flow.</p>
        </div>

        <div class="owner-card">
          {#if ownerProfile?.avatarUrl}
            <img class="owner-avatar" src={ownerProfile.avatarUrl} alt={`${ownerProfile.login} avatar`} />
          {:else}
            <div class="owner-avatar owner-avatar-fallback" aria-hidden="true">
              {parsedFlow?.owner?.slice(0, 1)?.toUpperCase() || '?'}
            </div>
          {/if}

          <div class="owner-copy">
            <div class="owner-title-row">
              <h3>{ownerProfile?.name || parsedFlow?.owner || 'Unknown owner'}</h3>
              {#if ownerProfile?.htmlUrl}
                <a class="owner-link" href={ownerProfile.htmlUrl} target="_blank" rel="noreferrer">View on GitHub</a>
              {/if}
            </div>
            <p class="owner-type">{ownerProfile?.type || humanizeKey(parsedFlow?.ownerType || 'owner')}</p>
            <p class="subtle small">@{ownerProfile?.login || parsedFlow?.owner}</p>
            {#if ownerProfileLoading}
              <p class="subtle small">Loading owner details from the public GitHub API.</p>
            {:else if ownerProfileError}
              <p class="subtle small">{ownerProfileError}</p>
            {/if}
          </div>
        </div>

        <div class="note small">
          Create the apps below in GitHub. Each manifest carries a per-app <code>state</code> value so the
          callback page can store returned codes in this browser session.
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

      <section class="stack">
        <div class="section-header">
          <h2>Apps to create</h2>
          <p>The list is collapsed by default. Expand any app to inspect its non-editable manifest preview.</p>
        </div>

        <div class="manifest-list">
          {#each manifests as item}
            <article class="manifest-shell">
              <div class="manifest-summary">
                <div class="manifest-title">
                  <h3>{item.label}</h3>
                  <p>{item.manifest.description || 'No description provided.'}</p>
                  <div class="manifest-meta">
                    <span class="pill"><code>{item.key}</code></span>
                    <span class="pill">{item.permissions.length} permissions</span>
                    <span class="pill">{item.events.length} events</span>
                    {#if session.codes?.[item.key]?.code}
                      <span class="pill pill-success">Creation initiated</span>
                    {:else}
                      <span class="pill pill-warning">Pending</span>
                    {/if}
                  </div>
                </div>

                <div class="manifest-controls">
                  <form action={`${actionUrl}?state=${encodeURIComponent(manifestState(item))}`} method="post" target="_blank">
                    <input type="hidden" name="manifest" value={JSON.stringify(item.manifest)} />
                    <button class="button" type="submit" disabled={Boolean(session.codes?.[item.key]?.code)}>
                      Create on GitHub
                    </button>
                  </form>
                  {#if session.codes?.[item.key]?.code}
                    <span class="subtle small">Creation initiated</span>
                  {/if}
                  <span class="subtle small">{permissionSummary(item)}</span>
                </div>
              </div>

              <details class="manifest-details">
                <summary></summary>
                <div class="manifest-preview">
                  <section class="preview-section">
                    <h4>General</h4>
                    <div class="field-grid">
                      <div class="field">
                        <label class="field-label" for={`name-${item.key}`}>GitHub App name</label>
                        <input id={`name-${item.key}`} class="readonly-input" type="text" readonly value={item.manifest.name || ''} />
                      </div>
                      <div class="field">
                        <label class="field-label" for={`url-${item.key}`}>Homepage URL</label>
                        <input id={`url-${item.key}`} class="readonly-input" type="text" readonly value={item.manifest.url || ''} />
                      </div>
                      <div class="field full">
                        <label class="field-label" for={`description-${item.key}`}>Description</label>
                        <textarea id={`description-${item.key}`} class="readonly-textarea" readonly value={item.manifest.description || ''}></textarea>
                      </div>
                      <div class="field full">
                        <div class="checkbox-row">
                          <span class="checkbox-line">
                            <input type="checkbox" checked={Boolean(item.manifest.public)} disabled />
                            <span>Public app</span>
                          </span>
                          <span class="field-help">Whether the manifest marks this app as publicly available.</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section class="preview-section">
                    <h4>Post installation</h4>
                    <div class="field-grid">
                      <div class="field full">
                        <label class="field-label" for={`redirect-${item.key}`}>Redirect URL</label>
                        <input id={`redirect-${item.key}`} class="readonly-input" type="text" readonly value={item.manifest.redirect_url || ''} />
                        <span class="field-help">GitHub sends the temporary manifest code back to this URL.</span>
                      </div>
                      <div class="field full">
                        <label class="field-label" for={`callbacks-${item.key}`}>Callback URLs</label>
                        <textarea id={`callbacks-${item.key}`} class="readonly-textarea" readonly value={(item.manifest.callback_urls || []).join('\n')}></textarea>
                        <span class="field-help">Installation callbacks, if supplied by the manifest payload.</span>
                      </div>
                      <div class="field full">
                        <label class="field-label" for={`setup-${item.key}`}>Setup URL</label>
                        <input id={`setup-${item.key}`} class="readonly-input" type="text" readonly value={item.manifest.setup_url || ''} />
                        <span class="field-help">Users are redirected here after installation if additional setup is required.</span>
                      </div>
                      <div class="field full">
                        <div class="checkbox-row">
                          <span class="checkbox-line">
                            <input type="checkbox" checked={Boolean(item.manifest.setup_on_update)} disabled />
                            <span>Redirect on update</span>
                          </span>
                          <span class="field-help">Redirect users to the setup URL when installations are updated.</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section class="preview-section">
                    <h4>Webhook</h4>
                    <div class="field-grid">
                      <div class="field full">
                        <div class="checkbox-row">
                          <span class="checkbox-line">
                            <input type="checkbox" checked={Boolean(item.manifest.hook_attributes?.active)} disabled />
                            <span>Active</span>
                          </span>
                          <span class="field-help">We will deliver event details when this hook is triggered.</span>
                        </div>
                      </div>
                      <div class="field full">
                        <label class="field-label" for={`webhook-${item.key}`}>Webhook URL</label>
                        <input id={`webhook-${item.key}`} class="readonly-input" type="text" readonly value={item.manifest.hook_attributes?.url || ''} />
                        <span class="field-help">Events will POST to this URL.</span>
                      </div>
                    </div>
                  </section>

                  <section class="preview-section">
                    <h4>Permissions</h4>
                    <p class="subtle small">
                      User permissions are granted on an individual user basis as part of the GitHub App authorization flow.
                    </p>

                    <div class="permission-panel">
                      <div class="permission-header">
                        <div>
                          <h5>Repository permissions</h5>
                          <p>Repository permissions permit access to repositories and related resources.</p>
                        </div>
                        <div class="pill-row">
                          <span class="pill pill-success">{permissionSummary(item)}</span>
                        </div>
                      </div>

                      <ul class="permission-list">
                        {#if item.permissions.length}
                          {#each item.permissions as [name, level]}
                            <li class="permission-row">
                              <div>
                                <h6>{humanizeKey(name)}</h6>
                                <p>{permissionDescription(name)}</p>
                              </div>
                              <select class="readonly-select" disabled value={accessLabel(level)}>
                                <option>{accessLabel(level)}</option>
                              </select>
                            </li>
                          {/each}
                        {:else}
                          <li class="permission-row">
                            <div>
                              <h6>No repository permissions</h6>
                              <p>This manifest did not request any default repository permissions.</p>
                            </div>
                            <span class="pill">None</span>
                          </li>
                        {/if}
                      </ul>
                    </div>
                  </section>

                  <section class="preview-section">
                    <h4>Webhook subscriptions</h4>
                    <div class="event-list">
                      {#if item.events.length}
                        {#each item.events as eventName}
                          <div class="permission-row">
                            <div>
                              <h6>{humanizeKey(eventName)}</h6>
                              <p>{eventDescription(eventName)}</p>
                            </div>
                            <span class="pill pill-success">Selected</span>
                          </div>
                        {/each}
                      {:else}
                        <div class="note small">No default webhook events were declared in this manifest.</div>
                      {/if}
                    </div>
                  </section>

                  <section class="preview-section">
                    <h4>Raw manifest</h4>
                    <pre class="code-block">{JSON.stringify(item.manifest, null, 2)}</pre>
                  </section>
                </div>
              </details>
            </article>
          {/each}
        </div>
      </section>

      <article class="status-card">
        <div class="progress-row">
          <div class="section-header">
            <h2>Progress</h2>
            <p>{stats.completed} of {stats.total} apps are being created.</p>
          </div>
          {#if stats.done}
            <span class="pill pill-success">Ready to copy</span>
          {:else}
            <span class="pill pill-warning">Waiting for callbacks</span>
          {/if}
        </div>

        <div class="progress-bar" aria-hidden="true">
          <span style={`width: ${stats.total ? (stats.completed / stats.total) * 100 : 0}%`}></span>
        </div>

        <div class="note small">
          The apps will not be visible in the GitHub UI until the creation process is finalized locally.
          Copy the confirmation JSON when it becomes available, then follow the original instructions to
          complete the flow.
        </div>

        <div class="actions">
          <button class="button" type="button" disabled={!stats.done} on:click={copyResult}>
            Copy confirmation JSON
          </button>
          <button class="button-secondary" type="button" on:click={syncSession}>Refresh session</button>
        </div>

        {#if copied}
          <div class="success small">Clipboard updated with the collected JSON map.</div>
        {/if}

        {#if copyError}
          <div class="warning small">{copyError}</div>
        {/if}

        <details>
          <summary class="subtle small">Show raw collected JSON</summary>
          <pre class="code-block">{encodedResult}</pre>
        </details>
      </article>
    </div>
  {/if}
</div>
