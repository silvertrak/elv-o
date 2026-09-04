# HTTP API spec

The server exposes an HTTP API implemented in `o-svc.js`.

General notes:

- Request routing is based on the URL path; the HTTP method (GET/POST/PUT/...) is not enforced, except `OPTIONS`, which always returns `200` with `{"timestamp": <ms>}` (used for CORS pre-flight).
- Input parameters can be supplied either as a JSON-encoded request body, or as URL query parameters (when there is no body).
  - Query parameters are read with `URLSearchParams` and are always strings. The server does not parse JSON, arrays, numbers, or booleans from query parameters. In particular, boolean query parameters such as `details=false`, `force=false`, `synchronous=false`, and `queue_active=false` are truthy strings and will behave as `true`. Use a JSON body for typed parameters.
- All responses are JSON (`Content-Type: application/json`), including `204` responses, which return the JSON body `null` (not an empty body).
- Response body is `{"error": ...}` on failure (unless noted) with an HTTP status code of `400` or `500`.
- Auth failures return `401` with `{"error": "Invalid API Key"}`.
- Auth requirement: all endpoints except plain `GET /` and `/heartbeat` require headers:
  - `api-key`: a key starting with `api_` (token) or an ECIES-encrypted legacy key.
  - `client-address`: the client's content fabric address (required for legacy keys only; for `api_` tokens the address is decoded from the token).
  - The server's whitelist (`authorized_address` metadata) maps a client address to a list of URL regular-expression patterns. The request is authorized only if the client address has an entry **and** the request URL matches one of that entry's patterns.
- `POST /` with `{"action": "<command>"}` routes the request to the corresponding command endpoint and is subject to the same auth requirement.

## `GET /`

Returns the list of supported commands with their argument definitions.

- No parameters.
- This endpoint is not authenticated.

Returns:

- `commands`: object mapping command name to argument spec. The command names returned by the current implementation are:
  - `queue_job`, `job_status`, `cancel_job`, `restart_job`, `create_jobs_queue`, `activate_jobs_queue`, `deactivate_jobs_queue`, `list_queued_items`, `get_queued_item_details`, `list_running_jobs`, `list_executed_jobs`, `clear_job_reference`, `execute_action`, `action`, `workflow_io`, `get_throttles`

Notes:

- The list is incomplete: `get_job_execution_steps` and `refresh_authorizations` are implemented as endpoints but are not advertised in this list.
- The advertised command `get_queued_item_details` does not correspond to a real route. The actual endpoint is `GET /get_queued_job_details`.
- The `queue_job` argument spec returned by the current implementation is malformed (`priority`, `job_reference`, and `job_description` are returned outside the `arguments` object). Treat this list as illustrative rather than authoritative.

## `GET /heartbeat`

Health check intended for use by load balancers.

## `POST /queue_job`

Queue a job for execution.

Input parameters:

- `queue_id`: identifier of the queue to use (required for successful queueing)
- `priority`: numeric, range 0-9999, default 100
  - Note: the current implementation uses `body.priority || 100`, so a priority of `0` is coerced to `100`. The range is not validated here.
- `job_reference`: unique identifier of the job. Although the spec originally listed this as required, the current implementation falls back to `job_description.parameters.job_reference`, then `job_description.id`, and finally generates `"job_<timestamp>"` if none are present.
- `job_description`: object describing the job (required; the current implementation throws a `500` if it is missing); supports
  - `id`: job id (defaults to the resolved item id, i.e. `job_reference` or the generated id)
  - `workflow_id` / `workflow_object_id`: workflow to execute (`workflow_id` defaults to `workflow_object_id`)
  - `parameters`: workflow parameters

Returns:

- `path`: path of the queued item
- `item`: the job description object as queued
- `queue_id`: identifier of the queue
- `queued`: true

Errors: `400` if the item could not be queued; `500` on internal error.

Note: the non-unique `job_reference` check is present in the code but currently broken (it references an undeclared variable), so a non-unique reference currently results in `500` rather than the intended `400`.

## `POST /create_jobs_queue`

Create a jobs queue.

Input parameters (JSON format)

- `queue_id`: identifier of the queue (required)
- `queue_name`: optional display name
- `queue_priority`: numeric, range 0-9999, default 100
  - Note: the current implementation uses `priority || 100`, so `0` is coerced to `100`. The range is not validated here.
- `queue_active`: boolean, default true
  - Note: because of the general query-parameter caveat, `queue_active=false` supplied as a query parameter is the string `"false"` and will be treated as active.

Returns:

- `queues`: the current set of queues

Errors: 500 if the queue could not be created.

## `POST /activate_jobs_queue`

Activate a queue (allow it to be processed).

Input parameters (JSON format)

- `queue_id`: identifier of the queue (required)

Returns:

- `queues`: the current set of queues

Errors: `500` if the queue could not be activated.

## `POST /deactivate_jobs_queue`

Deactivate a queue (prevent it from being processed).

Input parameters (JSON format)

- `queue_id`: identifier of the queue (required)

Returns:

- `queues`: the current set of queues

Errors: `500` if the queue could not be deactivated.

## `GET /job_status`

Get the status of a job.

Input parameters (JSON format)

- `job_reference`: unique identifier of the job (optional; either this or `job_id` may be used)
- `job_id`: job id (optional; either this or `job_reference` may be used)
- `details`: boolean, optional; if true, include per-step details
  - Note: `details=false` as a query parameter is the truthy string `"false"` and will enable details.

Returns when the job is not found:

- `job_id`: null
- `status`: `"unknown"`

Returns when the job is found:

- `job_id`: id of the job
- `status`: one of `unknown|queued|created|ongoing|complete|exception|failed|canceled`
- `status_code`: numeric status code
- `status_details`: object containing
  - `steps`: step execution status (`{step_id: step_info}` when `details` is true, otherwise the executed-steps metadata from `workflow_execution.steps`)

## `GET /list_queued_items`

List items waiting in queues.

Input parameters (JSON format)

- `queue_ids`: array of queue ids, or a single queue id (optional; when omitted, only **active** queues are listed)
- `limit`: numeric, default 0 (no limit)

Returns:

- When `queue_ids` is a single queue id: an array of item descriptors `{path, workflow_id, queue_id}`.
- When `queue_ids` is an array or omitted: an array of `{queue_id: [item descriptors]}` objects.

## `GET /get_queued_job_details`

Get details of a specific queued item.

Input parameters (JSON format)

- `queue_id`: identifier of the queue (required)
- `path`: path of the queued item (required)

Returns:

- The queued item details, or status `204` with JSON body `null` if not found.

Note: this endpoint is advertised as `get_queued_item_details` in the `GET /` command list, but the actual route is `/get_queued_job_details`.

## `GET /list_running_jobs`

List currently running jobs.

- No parameters.

Returns:

- Array of job objects (full job info).

## `GET /list_executed_jobs`

List previously executed jobs.

Input parameters (JSON format)

- `limit`: numeric, default 0 (no limit)
- `from_date`: date, default null
- `to_date`: date, default null
- `workflow_id`: workflow identifier (optional)
- `group_id`: group identifier (optional)

Notes:

- A `status_code` filter was previously documented but is **not implemented** in `o-svc.js`; the parameter is ignored.

Returns:

- Array of job execution objects (`workflow_execution` data).

## `GET /get_job_execution_steps`

Get the execution steps of a job.

Input parameters (JSON format)

- `job_id`: id of the job (required)

Returns:

- Execution steps data (object keyed by step id).

Errors: `400` on internal error.

## `POST /cancel_job`

Cancel a job.

To cancel a running job, provide a `job_id` or `job_reference`. To cancel a queued job, provide the `queue_id` and `path`.

Input parameters (JSON format)

- `job_id`: optional
- `job_reference`: optional
- `queue_id`: optional
- `path`: optional

Returns:

- `canceled`: boolean

Errors: `400` on internal error (for example, when neither a job nor a queue item is provided).

## `POST /restart_job`

Restart a job from a given step. A `job_id` or `job_reference` must be provided.

Input parameters (JSON format)

- `job_id`: optional
- `job_reference`: optional
- `step_id`: step to restart from (required)

Returns:

- `restarted`: boolean

Errors: `500` on internal error.

## `POST /clear_job_reference`

Clear a job and its reference (frees the reference for reuse).

Input parameters (JSON format)

- `job_reference`: unique identifier of the job (required)

Returns:

- `cleared`: an object describing the removed paths (containing `job_id` and the `running`, `executed`, and/or `job` paths that were removed), or `null` if nothing was found to clear.

Errors: `500` on internal error.

## `POST /execute_action`

Execute an action directly and synchronously.

Input parameters (JSON format)

- `synchronous`: boolean, default true (only synchronous execution is currently supported)
  - Note: `synchronous=false` as a query parameter is the truthy string `"false"` and will still run synchronously.
- `action`: action identifier (required)
- `parameters`: object of action parameters (required)
- `inputs`: object of action inputs (required)
- `variables`: optional object of variables

Returns (on success):

- The action results object (parsed from the action output file).

Errors: `400` with `execution_code`, `log_path`, `result_path` if the action failed; `500` on internal error. Asynchronous execution is not implemented (`400`).

## `POST /refresh_authorizations`

Refresh the authorized-address whitelist from the object metadata.

- No parameters.

Returns:

- `message`: "Authorized address list updated"

Errors: `500` if the whitelist could not be refreshed.

Note: this endpoint is implemented but not advertised in the `GET /` command list.

## `POST /action`

List all available actions, or get the spec of a specific action.

Input parameters (JSON format)

- `action`: action identifier (optional; if omitted, all actions are listed)
- `parameters`: object (optional)
- `force`: boolean (optional; re-read definitions from the fabric)

Note: an `inputs` parameter was previously documented but is **ignored** by the current implementation.

Returns (without `action`):

- `actions`: list of available actions

Returns (with `action`):

- The action spec object (or `null` if the action spec could not be retrieved).

## `GET /workflow_io`

Get the inputs and outputs of a workflow.

Input parameters (JSON format)

- `workflow_id`: workflow identifier (required)
- `workflow_object_id`: if present, the workflow definition is read from object metadata
- `force`: boolean (optional)

Returns (intended):

- `inputs`: workflow input parameters
- `outputs`: per-step output definitions `{step_id: {type: "object"}}`

Current implementation note: this endpoint is currently broken in `o-svc.js`. When only `workflow_id` is provided, the handler references an undefined variable (`workflowId`) and returns `500`. When `workflow_object_id` is provided, the handler reads metadata using `objectId: body.workflow_id` instead of `body.workflow_object_id`, which is likely the wrong object id.

## `GET /get_throttles`

Get current execution throttles.

Input parameters (JSON format)

- `workflow_id`: workflow identifier (optional; if provided, returns the limit for that workflow only)
- `force`: boolean (optional; re-retrieve from the fabric)

Returns (without `workflow_id`):

- Throttles object, e.g. `{workflow_id: limit}`

Returns (with `workflow_id`):

- When no throttle is defined for the requested workflow: `{workflow_id: 0}`.
- When a throttle is defined: due to a missing `return` in the current implementation, the full throttles object is returned rather than the single-workflow `{workflow_id: limit}` object.

## Unknown endpoints

If an authenticated request URL does not match any of the routes above, the server falls through and returns `200` with the raw request data as the body: `{body, headers, method, url}`. This behavior is not documented as a stable API and may change.
