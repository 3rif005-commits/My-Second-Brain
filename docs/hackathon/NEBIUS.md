# Nemotron on Nebius: the hackathon add-on

Built for the Nebius x NVIDIA Global AI Hackathon (Personal AI track, deadline Fri 30 Oct 2026,
10:00 PT). The rules require calling Nebius at runtime and using an NVIDIA open model.

**It is an add-on and can be removed.** With `NEBIUS_API_KEY` unset, none of it runs and the app
behaves as it did before. Every line it adds outside its own files is marked `HACKATHON-NEBIUS`:

```
grep -rn HACKATHON-NEBIUS --include=*.py --include=*.yaml --include=*.example .
```

## What it does

| Part | What runs | Where |
|---|---|---|
| Front door | A small Nemotron on **your own Nebius VM** | the `local` slot and the brain |
| Fast | Nemotron 3 Nano on Nebius Token Factory | the `fast` slot (the default) |
| Strong | Nemotron 3 Super on Nebius Token Factory | the `strong` and `long` slots |

The routing reuses the existing switchboard (rules, then the brain, then slots). The add-on only
changes the **default** routing policy. A policy you saved in Settings → Routing is left alone;
"Restore default" brings in the Nemotron setup.

- **Fixed rules (code, not the model):**
  - A context over 30,000 tokens always goes to the strong model.
  - Sensitive words go to the front door.
  - A request that needs private notes is moved to the front door.
- **Everything else:** the front-door Nemotron picks the slot.
- **If the VM is off:**
  - Requests and the brain fall back to Token Factory.
  - **Private notes never do.** The privacy gate holds them back, as it does for any cloud model.
  - If you pick "local" yourself and the VM is off, you get an error. You are never quietly sent
    to the cloud.
- **Without a VM** (Token Factory only): the brain is Nemotron Nano on Token Factory. It sees the
  message only, never note text.

Privacy note: the VM is treated like your own machine, so private notes may go to it. That is why
`NEBIUS_VM_URL` must be **https**. A plain-http address over the internet is refused, and the VM
counts as off.

## Settings (Render → Environment)

| Name | Needed | Meaning |
|---|---|---|
| `NEBIUS_API_KEY` | yes | Token Factory key. Unset = add-on off |
| `NEBIUS_VM_URL` | no | `https://…` address of the VM's server |
| `NEBIUS_VM_API_KEY` | with a VM | the `--api-key` the VM's server was started with |
| `NEBIUS_FAST_MODEL`, `NEBIUS_STRONG_MODEL`, `NEBIUS_VM_MODEL` | no | model ids (defaults in `core/config.py`) |
| `NEBIUS_PRICE_IN`, `NEBIUS_PRICE_OUT` | no | USD per 1M tokens for the run log. Unset = "unknown", never $0 |

Check the model ids against your account before the demo. Nebius pages spell them differently:

```
curl -s https://api.tokenfactory.nebius.com/v1/models -H "Authorization: Bearer $NEBIUS_API_KEY" | grep -i nemotron
```

## The VM (front door)

On a Nebius GPU VM (one L40S or H100 is enough for a 9B model):

```
# 1. the model server (OpenAI-compatible), with a key
docker run --gpus all -p 127.0.0.1:8000:8000 vllm/vllm-openai \
  --model nvidia/NVIDIA-Nemotron-Nano-9B-v2 --trust-remote-code \
  --api-key "$NEBIUS_VM_API_KEY"
# 2. https in front of it (automatic certificate; 203-0-113-7 = the VM's IP with dashes)
caddy reverse-proxy --from 203-0-113-7.sslip.io --to localhost:8000
```

- Then set `NEBIUS_VM_URL=https://203-0-113-7.sslip.io` on Render.
- The chat uses tools, so check the model card for vLLM's **tool-call** and **reasoning-parser**
  flags for this model. Without the reasoning parser, its thinking text can leak into answers.
- Turn the VM off after the demo. The app falls back to Token Factory by itself.

## How to remove it

1. Delete `backend/services/nebius.py`, `backend/tests/test_nebius.py` and this folder
   (`docs/hackathon/`).
2. Remove each `HACKATHON-NEBIUS` touchpoint (the grep above lists them):

   | File | Remove |
   |---|---|
   | `backend/core/config.py` | the `nebius_*` settings block |
   | `backend/services/router.py` | the VM step at the top of `get_endpoint` |
   | `backend/services/ai/providers.py` | the Token Factory lines in `_env_providers`; `local_provider` goes back to `label="Local (Gemma)"` |
   | `backend/services/ai/pricing.py` | the three `nebius.price_for` lines in `price_for` |
   | `backend/services/routing/policy.py` | `default_policy` goes back to `return copy.deepcopy(DEFAULT_POLICY)` |
   | `backend/services/routing/switchboard.py` | the VM check in `resolve_slot` |
   | `backend/services/routing/brain.py` | `brain_provider` goes back to `return local_provider()` |
   | `render.yaml`, `backend/.env.example` | the `NEBIUS_*` entries |

3. Run `grep -rn -i nebius backend render.yaml`. Only unrelated hits should remain.
4. Run the backend tests.
5. Delete the `NEBIUS_*` values on Render and turn off the VM.
6. **In Settings → Routing, click "Restore default"** (each account that saved a policy while
   the add-on was on). A saved policy that still names Token Factory finds no provider for
   those slots, and on the server the fallback ends at "local", which has no model there.

Nothing was added to the database and no migration is needed, either to add it or to remove it.
