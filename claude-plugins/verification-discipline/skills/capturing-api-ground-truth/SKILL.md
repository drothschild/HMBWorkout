---
name: capturing-api-ground-truth
description: Use when building a client, type definitions, or fixtures against an external HTTP API - capture ground truth with a raw curl call, because an MCP connector or SDK wrapper for that same service can silently rename response fields, and the rename is invisible to every test built on it.
---

# Capturing API Ground Truth

## Overview

**When building a client or mapper against an external API, capture fixtures via
a raw HTTP call — never via an MCP connector or SDK wrapper, even one for the
exact same service.**

Wrapper packages routinely normalize or rename response fields to match their
own conventions, or to match the service's own published documentation — which
may itself be wrong. That normalization is invisible unless you go around it.

## The failure this prevents

An importer shipped with a type declaring `supersets_id` (plural). The field was
captured, fixture-built, and verified — including with an explicit "verified
against the live API" claim — entirely through the service's MCP tool.

The real HTTP API sends `superset_id` (singular), in every response. Confirmed
by two independent raw `curl` calls against the same live account, on two
endpoints. The npm wrapper silently renamed the field to match the service's own
OpenAPI document, which is **internally inconsistent**: its GET response schema
says plural, its POST/PUT request schemas say singular, and the real server
matches the singular convention on GET too.

Net effect: the field the code read is never present in production. **No import
ever preserved a superset, for any user** — a total, silent failure that passed
unit tests, mutation tests, and a live-sourced "verbatim" fixture, because every
one of those was validated against normalized data rather than the wire bytes.

## The check

Before declaring a fixture "verbatim" or a field mapping "verified against the
live API", make at least one raw call and diff the keys:

```bash
curl -s -H "api-key: $KEY" https://api.example.com/v1/routines?page=1 \
  | jq -S 'paths(scalars) | join(".")' | sort -u > /tmp/wire.keys

# and the same shape via whatever tool you explored with
diff /tmp/wire.keys /tmp/tool.keys
```

Any difference is a rename, a drop, or an addition — all three break a mapper.

## Why this is not paranoia about data integrity

The risk is not that the connector lies about *values*. Read-only connectors are
usually trustworthy about data. The risk is **field-name fidelity**, and it is
orthogonal to trustworthiness — the wrapper is faithfully implementing its own
documented interface, which is simply not the wire format.

**"I checked via a tool" is not the same claim as "I checked the actual wire
format."** Treating them as interchangeable is exactly how this survived every
checkpoint. See `verifying-claims-by-execution`.

## Applies to

Any wrapper between you and the wire: MCP connectors, official and unofficial
SDKs, API-explorer UIs, recorded HAR files from a proxy that rewrites, and
documentation examples.

It does **not** apply once you have the raw bytes: a fixture captured from curl
and committed is ground truth, and re-deriving it later is unnecessary.

## Quick reference

| Step | Action |
|---|---|
| Explore | Any tool is fine — connector, SDK, docs |
| Fix the contract | One raw `curl` with the real auth header at the documented base URL |
| Compare | Diff the key sets, not the values |
| Commit | Save the curl output as the fixture, with the command in a comment |
| Claim | Say which one you checked — tool or wire |

## Common mistakes

| Mistake | Consequence |
|---|---|
| Building fixtures from a connector's output | A silent rename makes the mapper read a field that never arrives |
| Trusting the service's own OpenAPI document | It can disagree with its own server, and with itself between GET and POST |
| Calling connector-sourced data "verbatim" | The claim is unfalsifiable downstream and gets relayed |
| Checking one endpoint only | Confirm on both list and single-item responses |
