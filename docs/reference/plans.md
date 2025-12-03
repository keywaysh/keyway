---
sidebar_position: 4
title: Plans & Pricing
---

# Plans & Pricing

Keyway offers three plans to match your needs.

## Plan comparison

| Feature | Free | Pro | Team |
|---------|:----:|:---:|:----:|
| **Price** | $0/month | $9/month | $29/month |
| Public repositories | Unlimited | Unlimited | Unlimited |
| Private repositories | 1 | Unlimited | Unlimited |
| Private org repositories | - | - | Unlimited |
| Provider connections | 1 | Unlimited | Unlimited |
| Environments per vault | 2 | Unlimited | Unlimited |
| Secrets per private vault | 20 | Unlimited | Unlimited |
| Secrets per public vault | Unlimited | Unlimited | Unlimited |
| Secret value size | 64 KB | 64 KB | 256 KB |
| Audit log retention | 7 days | 30 days | 90 days |
| Push batch size | 100 | 500 | 1,000 |

---

## Free plan

Perfect for personal projects and open source.

**Includes:**
- Unlimited public repository vaults
- 1 private repository vault
- 1 provider connection (Vercel, Netlify, etc.)
- 2 environments per vault (e.g., `local`, `production`)
- 20 secrets per private vault
- 7-day audit log retention

**Best for:**
- Personal projects
- Open source maintainers
- Evaluating Keyway

---

## Pro plan

For professional developers with multiple projects.

**Includes everything in Free, plus:**
- Unlimited private repositories
- Unlimited provider connections
- Unlimited environments per vault
- Unlimited secrets per vault
- 30-day audit log retention
- 500 secrets per push batch

**Best for:**
- Professional developers
- Multiple personal projects
- Freelancers and consultants

**Price:** $9/month (billed monthly) or $90/year (save $18)

---

## Team plan

For teams and organizations.

**Includes everything in Pro, plus:**
- Private organization repositories
- 256 KB secret value size
- 90-day audit log retention
- 1,000 secrets per push batch

**Best for:**
- Development teams
- Organizations
- Projects requiring shared private repositories

**Price:** $29/month (billed monthly) or $290/year (save $58)

---

## FAQ

### Can I use Keyway for free?

Yes! The Free plan is perfect for personal and open source projects. You get unlimited public repository vaults and one private repository vault at no cost.

### What happens if I exceed my limits?

You'll receive a `403 Plan Limit Exceeded` error with a link to upgrade. Your existing data remains accessible - you just can't create new resources beyond your limits.

### What happens if I downgrade?

Your existing vaults remain accessible. For private repositories, we use FIFO (First In, First Out): your oldest private vault stays fully writable, while newer ones become read-only until you upgrade again.

### Can I change plans?

Yes, you can upgrade or downgrade at any time from the Settings page. Upgrades take effect immediately. Downgrades take effect at the end of your billing period.

### Do you offer annual billing?

Yes! Annual billing saves you 2 months compared to monthly billing:
- Pro: $90/year (instead of $108)
- Team: $290/year (instead of $348)

### What payment methods do you accept?

We accept all major credit cards through Stripe. For Team plans with annual billing, we can also arrange invoicing.

### Is there a trial period?

We don't offer trials because the Free plan lets you evaluate Keyway without any time limit. When you're ready for more, you can upgrade instantly.

---

## Upgrade your plan

### Via Dashboard

1. Go to **Settings** → **Billing & Plan**
2. Click **Upgrade to Pro** or contact us for Team
3. Complete payment through Stripe

### Via CLI

The CLI will suggest upgrading when you hit a limit:

```
⚠ Free plan allows 1 private repo. Upgrade to Pro for unlimited.
⚡ Upgrade: https://app.keyway.sh/upgrade
```

---

## Questions?

Contact us at support@keyway.sh for:
- Enterprise pricing
- Volume discounts
- Custom requirements
