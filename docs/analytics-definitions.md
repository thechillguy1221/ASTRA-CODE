# Astra AI analytics definitions

These definitions keep the admin console from presenting plausible but ambiguous numbers.

- **DAU:** unique authenticated users who complete a meaningful activity in UTC during one calendar
  day. Meaningful activity includes opening a workspace, starting a task, completing verification,
  or changing an account/billing setting; page views alone do not count.
- **MAU:** unique users with the same meaningful activity during the selected UTC 30-day window.
- **Active paid subscriber:** a subscription in a backend entitlement state that grants paid access
  at the measurement timestamp.
- **Provider AI cost:** request-level actual cost when the provider/gateway supplies it; otherwise
  the best clearly-labelled calculated cost from the model pricing metadata.
- **Customer billable cost:** the amount settled against the user's reservation. It is not inferred
  from tokens without model-specific pricing metadata.
- **Absorbed cost:** provider cost that Astra chooses not to bill because of an Astra-caused failure
  or an explicit support/admin decision.
- **AI gross margin:** customer-billable AI cost minus provider AI cost, before payment fees, tax,
  support, infrastructure, and other operating costs.

When the required database/provider data is unavailable, the API returns `NO_LIVE_DATA`; the admin
UI must not render zeros or a green health state in its place.
