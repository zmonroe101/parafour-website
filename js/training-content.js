// ═══════════════════════════════════════════════════════════════
//  training-content.js — Intro training lesson bodies
//  Depends on: nothing (pure content). Loaded by training pages.
//
//  Module metadata + quiz questions live in Supabase
//  (training_modules / training_quiz_questions — see
//  supabase/subscription-model-schema.sql). Lesson body HTML lives
//  here because it's rich static content (incl. the Module 1
//  interactive product selector), which doesn't belong in SQL seeds.
//  The two are linked by fixed module UUIDs + order_index.
// ═══════════════════════════════════════════════════════════════

const TRAINING_MODULE_UUIDS = {
  1: 'a0000000-0000-4000-8000-000000000001',
  2: 'a0000000-0000-4000-8000-000000000002',
  3: 'a0000000-0000-4000-8000-000000000003',
  4: 'a0000000-0000-4000-8000-000000000004',
  5: 'a0000000-0000-4000-8000-000000000005',
};

const TRAINING_CONTENT = {

  // ─────────────────────────────────────────────────────────────
  1: {
    title: 'What to Order',
    minutes: 10,
    summary: 'Interactive product selector — get a P4 Series configuration recommendation for your site.',
    html: `
      <p>Ordering the wrong dispenser configuration is the #1 cause of frustrating installs. This module walks
      you through the five questions that determine exactly which P4 Series setup fits your site — then makes a
      recommendation you can attach to your quote request.</p>

      <h3>The five questions that matter</h3>
      <ul>
        <li><strong>Flow capacity (GPM):</strong> how many gallons per minute do you actually need? Fleet fueling
        typically wants higher flow; forklift-cylinder filling needs far less. Your pump, piping, and meter must all
        be sized for it.</li>
        <li><strong>Nozzle configuration:</strong> a single-nozzle unit serves one vehicle at a time; a dual-nozzle
        (dual-hose) unit fuels two points simultaneously from one cabinet.</li>
        <li><strong>Power:</strong> the electronics and pump motor must match the supply you have on site
        (110V vs 220V). Confirm what's at the island <em>before</em> ordering.</li>
        <li><strong>Environment:</strong> outdoor forecourt installs are standard; any enclosed or indoor
        application has additional ventilation and code requirements — talk to us first.</li>
        <li><strong>Retail vs private use:</strong> selling by the gallon to the public requires an
        <strong>NTEP Category 1</strong> (legal-for-trade) metering system — that's the P4 Retail configuration.
        Private fleet use doesn't.</li>
      </ul>

      <h3>Try it: interactive product selector</h3>
      <div class="selector-card" id="productSelector">
        <div class="form-group">
          <label for="selUse">What will the dispenser be used for?</label>
          <select id="selUse">
            <option value="">Select…</option>
            <option value="fleet">Private fleet / company vehicles</option>
            <option value="retail">Retail autogas sales to the public</option>
            <option value="cylinder">Cylinder / forklift tank filling</option>
          </select>
        </div>
        <div class="form-group">
          <label for="selFlow">How much flow do you need?</label>
          <select id="selFlow">
            <option value="">Select…</option>
            <option value="low">Standard (up to ~10 GPM — cars, forklift cylinders)</option>
            <option value="high">High (10+ GPM — trucks, buses, high-volume fleet)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="selNozzles">How many vehicles fuel at once?</label>
          <select id="selNozzles">
            <option value="">Select…</option>
            <option value="single">One at a time (single nozzle)</option>
            <option value="dual">Two at a time (dual nozzle)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="selPower">What power is available at the island?</label>
          <select id="selPower">
            <option value="">Select…</option>
            <option value="110">110V single-phase</option>
            <option value="220">220V</option>
          </select>
        </div>
        <div class="form-group">
          <label for="selDistance">How far is the storage tank from the fueling island?</label>
          <select id="selDistance">
            <option value="">Select…</option>
            <option value="near">Close (pump can live in the dispenser cabinet)</option>
            <option value="far">Far (50+ ft — pump should sit at the tank)</option>
          </select>
        </div>
        <button type="button" class="btn btn-primary" id="selectorBtn">Get Recommendation</button>
        <div class="selector-result" id="selectorResult" style="display:none;"></div>
      </div>

      <p class="training-note">This recommendation is a starting point, not a final spec — include it in a quote
      request and our team will confirm sizing against your tank, piping, and local code requirements.</p>
    `,
    // Wires up the interactive selector after the HTML is injected.
    init() {
      const btn = document.getElementById('selectorBtn');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const use      = document.getElementById('selUse').value;
        const flow     = document.getElementById('selFlow').value;
        const nozzles  = document.getElementById('selNozzles').value;
        const power    = document.getElementById('selPower').value;
        const distance = document.getElementById('selDistance').value;
        const result   = document.getElementById('selectorResult');

        if (!use || !flow || !nozzles || !power || !distance) {
          result.style.display = 'block';
          result.innerHTML = '<strong>Please answer all five questions</strong> to get a recommendation.';
          return;
        }

        let model, notes = [];
        if (use === 'retail') {
          model = 'P4 Series — Retail Configuration';
          notes.push('Includes NTEP Category 1 legal-for-trade metering, required for per-gallon retail sales.');
        } else if (distance === 'far') {
          model = 'P4 Series — Remote Dispenser';
          notes.push('Pump mounts at the tank; the dispenser at the island handles metering and control — the right layout for long tank-to-island runs.');
        } else {
          model = 'P4 Series — Standard Configuration';
        }
        if (nozzles === 'dual') notes.push('Specify the dual-nozzle option to fuel two vehicles simultaneously.');
        if (flow === 'high') notes.push('Specify the high-flow pump/meter package (10+ GPM) — confirm supply piping is sized to match.');
        if (use === 'cylinder') notes.push('For cylinder filling, ask about the fill-scale and low-flow nozzle accessories.');
        notes.push(power === '110'
          ? 'Confirm the 110V single-phase motor option when ordering.'
          : 'Confirm the 220V motor option when ordering.');

        result.style.display = 'block';
        result.innerHTML = `
          <div class="selector-result-model">✅ Recommended: ${model}</div>
          <ul>${notes.map(n => `<li>${n}</li>`).join('')}</ul>
        `;
      });
    },
  },

  // ─────────────────────────────────────────────────────────────
  2: {
    title: 'Understanding LPG Dispensers',
    minutes: 12,
    summary: 'How a dispenser works, its safety features, and the standards that govern it.',
    html: `
      <div class="training-video-placeholder">▶ Video walkthrough coming soon — the written lesson below covers everything in the quiz.</div>

      <h3>What is an LPG dispenser?</h3>
      <p>An LPG (propane/autogas) dispenser transfers <strong>liquefied petroleum gas as a pressurized liquid</strong>
      from a storage tank into a vehicle or cylinder, measuring exactly how much was delivered. Unlike gasoline —
      which is a liquid at normal pressure — LPG is only liquid because it's kept under pressure, so
      <strong>every component in the flow path is sealed and pressure-rated</strong>.</p>

      <h3>The main components</h3>
      <ul>
        <li><strong>Pump:</strong> pushes liquid LPG from the tank through the system (in the cabinet, or at the tank on remote configurations).</li>
        <li><strong>Inline filter/strainer:</strong> catches debris before it reaches the meter.</li>
        <li><strong>Meter:</strong> measures the volume of liquid dispensed. On retail units this is NTEP Category 1 certified (legal for trade).</li>
        <li><strong>Differential (bypass) valve:</strong> maintains the pressure differential that keeps <em>liquid</em> — not vapor — flowing through the meter, and routes excess flow back to the tank. Without it, readings drift and flow gets erratic.</li>
        <li><strong>ProCE register/calculator:</strong> the electronic brain — displays volume and price, counts meter pulses, and enforces protections like no-flow timeouts.</li>
        <li><strong>Hose, breakaway coupling, and nozzle:</strong> the breakaway separates cleanly and seals <em>both</em> ends if a vehicle drives off with the nozzle connected.</li>
      </ul>

      <h3>Safety features</h3>
      <ul>
        <li><strong>Emergency stop:</strong> cuts pump power instantly.</li>
        <li><strong>Excess-flow valves:</strong> slam shut if flow suddenly spikes (e.g., a line break).</li>
        <li><strong>Breakaway coupling:</strong> drive-away protection (see above).</li>
        <li><strong>Grounding/bonding points:</strong> prevent static discharge around propane vapor.</li>
      </ul>

      <h3>Standards you'll hear about</h3>
      <ul>
        <li><strong>NFPA 58</strong> — the Liquefied Petroleum Gas Code: governs LPG storage, handling, and dispensing systems in the US.</li>
        <li><strong>NTEP Category 1</strong> — metering certification required to sell by the gallon.</li>
        <li><strong>ETL / CE / GOST</strong> — electrical and market certifications carried by the P4 Series.</li>
      </ul>

      <h3>Common misconceptions</h3>
      <ul>
        <li><em>"It's just like a gas pump."</em> — No: LPG is a pressurized liquefied gas; components, fittings, and procedures are different.</li>
        <li><em>"Propane lines can be serviced like water lines."</em> — Never open a pressurized LPG component; that's licensed-technician work.</li>
        <li><em>"The meter measures gas."</em> — It measures <em>liquid</em>; that's why vapor in the line (vapor lock) causes bad readings.</li>
      </ul>
    `,
  },

  // ─────────────────────────────────────────────────────────────
  3: {
    title: 'Installation Basics',
    minutes: 10,
    summary: 'Who installs it, what actually happens, how long it takes, and which inspections apply.',
    html: `
      <div class="training-video-placeholder">▶ Video walkthrough coming soon — the written lesson below covers everything in the quiz.</div>

      <h3>Can I install this myself?</h3>
      <p>Short answer: <strong>the gas side, no.</strong> Anything touching pressurized LPG — tank connections,
      piping, valves, the dispenser's liquid inlet — must be done by a <strong>licensed/certified LPG technician</strong>
      who knows NFPA 58 and your local codes. Site prep (concrete pad, conduit, bollards) can be handled by your own
      contractor ahead of time.</p>

      <h3>What a professional installation includes</h3>
      <ol>
        <li>Setting and anchoring the dispenser on the prepared pad/island.</li>
        <li>Connecting and pressure-testing the liquid supply (and vapor return where used).</li>
        <li>Electrical hookup — correct voltage, grounding, and bonding (static discharge around propane vapor is a real ignition risk).</li>
        <li>Commissioning: purging air, verifying pump pressure and the differential valve, checking meter accuracy.</li>
        <li>Leak-testing every joint before first fill.</li>
      </ol>

      <h3>Typical timeline</h3>
      <p>With the site prepared (pad poured, power run, piping stubbed), the dispenser installation itself takes
      <strong>2–4 hours</strong>. What makes projects drag is site prep and permitting — start those early.</p>

      <h3>Inspections &amp; certification</h3>
      <ul>
        <li><strong>AHJ / fire code:</strong> your local authority (often the fire marshal) signs off on the installation per NFPA 58.</li>
        <li><strong>Weights &amp; measures:</strong> if you sell fuel by the gallon, the state must certify the meter before retail operation.</li>
      </ul>

      <h3>Common installation mistakes</h3>
      <ul>
        <li><strong>Undersized pump or supply piping</strong> — the #1 cause of "it's always been slow."</li>
        <li>Wrong voltage assumptions — confirm 110V vs 220V before the electrician leaves.</li>
        <li>Skipping grounding/bonding.</li>
        <li>No bypass/differential-valve return path, causing vapor lock and dead-headed pumps.</li>
        <li>Not scheduling weights &amp; measures early enough — this can delay retail opening by weeks.</li>
      </ul>
    `,
  },

  // ─────────────────────────────────────────────────────────────
  4: {
    title: 'Operation & Maintenance',
    minutes: 12,
    summary: 'Daily, monthly, and annual care that prevents most emergency service calls.',
    html: `
      <div class="training-video-placeholder">▶ Video walkthrough coming soon — the written lesson below covers everything in the quiz.</div>

      <h3>Daily operation checklist</h3>
      <ul>
        <li><strong>Visual inspection</strong> of hose, nozzle, and connections — look for leaks, cuts, bulges, abrasion.</li>
        <li>Confirm the display powers up and reads zero.</li>
        <li>Check the area: no vegetation, trash, or ignition sources near the dispenser; emergency stop unobstructed.</li>
      </ul>

      <h3>Monthly maintenance</h3>
      <ul>
        <li><strong>Inspect the inline filter/strainer</strong> — replace when pressure drop or falling flow rate says it's clogging.</li>
        <li>Exercise the breakaway coupling and check the nozzle o-rings.</li>
        <li>Watch a full fill: steady flow and a stable meter reading. Creep or stutter is an early warning.</li>
        <li>Verify safety decals and operating instructions are legible.</li>
      </ul>

      <h3>Annual maintenance</h3>
      <ul>
        <li><strong>Meter proving/calibration</strong> by a qualified technician (required annually in most retail jurisdictions).</li>
        <li>Hose inspection against manufacturer date codes — replace on age or condition, whichever comes first.</li>
        <li>Full leak-check of the cabinet plumbing; inspect relief and excess-flow valves.</li>
        <li>Electrical check: grounding continuity, contactor wear, conduit seals.</li>
      </ul>

      <h3>Warning signs — schedule service now</h3>
      <ul>
        <li>Steadily <strong>declining flow rate</strong> (filter, pump, or vapor problems).</li>
        <li><strong>Repeating error codes</strong>, meter creep, or erratic display readings.</li>
        <li>Unusual pump noise (cavitation) or any smell of gas near the cabinet.</li>
      </ul>

      <h3>Winterization (cold climates)</h3>
      <p>Propane doesn't freeze in normal service, but winter still bites: <strong>tank pressure drops with
      temperature</strong>, which cuts the pressure differential the system depends on, and any <strong>moisture</strong>
      in the fuel system can freeze regulators and valves. Before winter: service filters, verify pump performance,
      confirm any cabinet heater works, and ask your propane supplier about methanol treatment if moisture has ever
      been an issue.</p>
    `,
  },

  // ─────────────────────────────────────────────────────────────
  5: {
    title: 'Troubleshooting Guide',
    minutes: 15,
    summary: 'Fix the common stuff yourself — and recognize what you must never touch.',
    html: `
      <div class="training-video-placeholder">▶ Video demos coming soon — the written guide below covers everything in the quiz.</div>

      <p class="training-note"><strong>Safety first:</strong> if you smell gas at any point — stop, hit the emergency
      stop, isolate the supply valves, keep ignition sources away, and call for service. Never open pressurized LPG
      components yourself.</p>

      <h3>"No fuel dispensing" (display is on)</h3>
      <ol>
        <li>Check <strong>tank liquid level</strong> — below ~10% the pump may not prime.</li>
        <li>Confirm <strong>all manual shutoff valves are open</strong> (tank, supply line, cabinet inlet).</li>
        <li>Opened a valve fast and flow stopped dead? The <strong>excess-flow valve slammed shut</strong> — close the valve, wait a few seconds, reopen it slowly.</li>
        <li>Check whether the pump is actually running (listen). If not, see "Pump won't start."</li>
      </ol>

      <h3>"Slow dispensing"</h3>
      <ol>
        <li><strong>Clogged inline filter/strainer</strong> — the most common cause by far. Have it inspected/replaced.</li>
        <li>Hot day, erratic flow, meter creep? <strong>Vapor lock</strong> — vapor is reaching the meter. Check the differential/bypass valve setting and tank pressure.</li>
        <li>A partially closed valve somewhere in the supply run.</li>
        <li>If it has been slow <em>since day one</em>: likely an undersized pump or piping — an installation issue, not a maintenance one.</li>
      </ol>

      <h3>"Pump won't start"</h3>
      <ol>
        <li><strong>Circuit breaker / power supply</strong> first.</li>
        <li>Emergency stop engaged or wiring interrupted?</li>
        <li>Is the register authorizing? (A fault code on the display can be blocking the start signal.)</li>
        <li>Motor hums but doesn't spin, or trips the breaker → stop and call service.</li>
      </ol>

      <h3>Error codes — what the register is telling you</h3>
      <ul>
        <li><strong>Pulser error:</strong> the meter's pulse output signal (or its wiring) is faulty — the register can't count flow.</li>
        <li><strong>No-flow timeout:</strong> the pump ran but no flow was measured, so the dispenser shut itself off — check valves, tank level, and filter.</li>
        <li><strong>Communication error:</strong> register can't reach a connected device (POS, remote console) — check cabling before anything else.</li>
        <li>The full P4 Series error-code reference (portal → Error Codes) lists every code with corrective actions.</li>
      </ul>

      <h3>Call support — don't DIY</h3>
      <ul>
        <li>Any suspected leak, any smell of gas, any hissing.</li>
        <li>Anything requiring opening the pressurized liquid path (meter, differential valve, pump seals).</li>
        <li>Meter accuracy disputes on retail units (weights &amp; measures implications).</li>
        <li>Repeated breaker trips or scorched wiring.</li>
      </ul>
    `,
  },
};
