# Agent area: On the road

**Scope.** Breakdowns, missed ships, and delays for cars already in motion.

**What the agent does first (cheap work, no approval needed):**
1. Reads the open alert and the order, driver, messages, documents, and travel rows attached to it.
2. Asks the driver for the missing fact (safe? where exactly? photo?) — simulated in this build.
3. Looks up the car, the plan, the ferry booking vs. quote, and the promised delivery.

**What it stops to ask a person:**
- Any change of booking, date, or cost.
- Any message to a customer.
- Any case where the evidence does not support a single next action.

**What it hands over:**
- One decision per card: the situation in one sentence, what the agent already found out, the proposed action, the effect of accepting it, and the ids behind every fact.

**Where it stops on its own:**
- When the driver's reply, the ferry booking, or the handover evidence is missing or disputed. The card shows "Stopped" with the missing fact, not an Accept button.
