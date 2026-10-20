/**
 * The tools the MCP server exposes.
 *
 * Every write reads the board back afterwards, so the model always sees what
 * the keyboard actually holds rather than what it asked for.
 */
import * as P from '../protocol.js';
import { decodeKey } from '../keys.js';
import { gridSource, sampleKeys } from '../art.js';
import {
  DIRECTIONS,
  LIGHT_GROUPS,
  REPORT_RATES,
  effectCatalogue,
  hexColour,
  parseColour,
  resolveKey,
} from './session.js';

const effectName = id => {
  const found = effectCatalogue().find(effect => effect.id === id);
  return found ? found.name : `mode ${id}`;
};

const directionName = value => {
  const found = DIRECTIONS.find(direction => direction.value === value);
  return found ? found.name : String(value);
};

const reportRateName = value => {
  const found = REPORT_RATES.find(rate => rate.value === value);
  return found ? found.name : String(value);
};

function lightingView(func) {
  return {
    profile: func.profile,
    mode: func.lightMode,
    mode_name: effectName(func.lightMode),
    brightness: func.lightBrightness,
    speed: func.lightSpeed,
    direction: func.lightDirection,
    direction_name: directionName(func.lightDirection),
    colour: hexColour(func.lightR, func.lightG, func.lightB),
    rainbow: func.mixColor === 1,
    group: func.lightGroup,
    group_name: LIGHT_GROUPS[func.lightGroup] ?? `Group ${func.lightGroup}`,
    wasd_lighting: !!func.keyWasd,
    win_lock: !!func.lockWin,
    six_key_nk: !!func.sixKeyNoConflict,
    report_rate: func.reportRate,
    report_rate_name: reportRateName(func.reportRate),
    hit_rate: func.hitRate,
    hit_delay: func.hitDelay,
    custom_base: hexColour(func.customBaseR, func.customBaseG, func.customBaseB),
  };
}

function numberIn(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}.`);
  }
  return Math.round(n);
}

export const TOOLS = [
  {
    name: 'ronin_status',
    title: 'Keyboard status',
    description:
      'Read the keyboard: identity, firmware, the active lighting profile, the current lighting settings and how the server is connected. Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(args, session) {
      const result = await session.withDevice(async client => {
        const base = await client.getDeviceBaseInfo();
        const profile = Math.min(P.PROFILE_COUNT - 1, base.profile || 0);
        const func = await client.getFuncInfo(profile);
        const board = await session.board(client);
        return {
          device: {
            vendor_id: `0x${base.vendorId.toString(16)}`,
            product_id: `0x${base.productId.toString(16)}`,
            firmware: `0x${base.firmwareVer.toString(16).toUpperCase()}`,
            protocol_tag: base.protocolTag,
            protocol_version: base.protocolVer,
            keyboard_type: base.keyboardType,
            keyboard_id: base.keyboardId,
          },
          active_profile: profile,
          lighting: lightingView(func),
          board: {
            keys: board.keys.length,
            mapped_slots: board.keys.filter(k => k.slot !== null).length,
            unmapped_slots: board.unmapped.length,
          },
          keymap_layers: P.LAYERS,
          lighting_profiles: P.PROFILE_COUNT,
          connection: session.mode === 'bridge' ? 'local bridge' : 'USB HID',
        };
      });

      const text = [
        `Keyboard ${result.device.vendor_id}:${result.device.product_id}, firmware ${result.device.firmware}.`,
        `Profile ${result.active_profile + 1} of ${result.lighting_profiles}, lighting ${result.lighting.mode_name}, brightness ${result.lighting.brightness}, speed ${result.lighting.speed}.`,
        `Board: ${result.board.keys} keys, ${result.board.mapped_slots} mapped slots, ${result.keymap_layers} keymap layers.`,
        `Connected over ${result.connection}.`,
      ].join('\n');
      return { text, structured: result };
    },
  },

  {
    name: 'ronin_effects',
    title: 'Lighting effects',
    description:
      'List the lighting effects the board supports with their ids, plus the direction, group and report rate values. Use the effect name to set a mode.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const effects = effectCatalogue();
      const structured = {
        effects,
        directions: DIRECTIONS,
        groups: LIGHT_GROUPS,
        report_rates: REPORT_RATES,
        brightness: { min: 0, max: P.MAX_BRIGHTNESS },
        speed: { min: 0, max: P.MAX_SPEED },
        per_key_mode: { id: P.MODE_CUSTOM, name: 'Custom (per-key RGB)' },
        off_mode: { id: P.MODE_OFF, name: 'Off' },
      };
      const text = [
        'Effects: ' + effects.map(effect => `${effect.name} (${effect.id})`).join(', '),
        'Directions: ' + DIRECTIONS.map(direction => `${direction.name} (${direction.value})`).join(', '),
        `Brightness 0-${P.MAX_BRIGHTNESS}, speed 0-${P.MAX_SPEED}, report rate: ` +
          REPORT_RATES.map(rate => `${rate.name} (${rate.value})`).join(', '),
      ].join('\n');
      return { text, structured };
    },
  },

  {
    name: 'ronin_keymap_read',
    title: 'Read keymap',
    description:
      'Read one keymap layer. Returns every key with its physical name (F5, Space, ...) and what it is assigned to. Use layer 0 for the main layer; the board has four layers.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'integer', minimum: 0, maximum: P.LAYERS - 1, description: 'Keymap layer, 0-3. Default 0.' },
        factory: { type: 'boolean', description: 'Read the factory keymap instead of the stored one.' },
        only_assigned: { type: 'boolean', description: 'Skip keys with no assignment. Default true.' },
      },
      additionalProperties: false,
    },
    async handler(args, session) {
      const layer = numberIn(args.layer ?? 0, 0, P.LAYERS - 1, 'layer');
      const factory = !!args.factory;
      const onlyAssigned = args.only_assigned !== false;

      const result = await session.withDevice(async client => {
        const board = await session.board(client);
        const keymap = await client.getKeymap(layer, factory);
        const keys = keymap.keys
          .map((entry, slot) => ({
            slot,
            key: session.nameOfSlot(slot),
            assigned: decodeKey(entry.type, entry.code1, entry.code2),
            type: entry.type,
            code1: entry.code1,
            code2: entry.code2,
          }))
          .filter(row => !onlyAssigned || row.assigned !== '');
        return { layer, factory, keys, unmapped: board.unmapped.length };
      });

      const text = result.keys.length
        ? result.keys.map(row => `${row.key ?? `slot ${row.slot}`}: ${row.assigned}`).join('\n')
        : 'No keys are assigned on this layer.';
      return { text, structured: result };
    },
  },

  {
    name: 'ronin_keymap_write',
    title: 'Write keymap',
    description:
      'Assign keys on a layer. Each assignment names a physical key ("F5", "Space", "Num 5") or a slot number, and a value ("A", "Ctrl+Shift+A", "Mouse 4", "Fn 3", "Unassigned"). Keys that are not listed keep their assignment. The layer is read back afterwards and the result is reported.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'integer', minimum: 0, maximum: P.LAYERS - 1, description: 'Keymap layer, 0-3. Default 0.' },
        assignments: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Physical key name, e.g. "F5".' },
              slot: { type: 'integer', minimum: 0, maximum: P.KEYMAP_SLOTS - 1, description: 'Keymap slot number.' },
              value: {
                description:
                  'What the key should do: a key name ("A", "Ctrl+Shift+A", "Mouse 4", "Fn 3", "Unassigned") or a raw entry { type, code1, code2 }.',
              },
            },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
      required: ['assignments'],
      additionalProperties: false,
    },
    async handler(args, session) {
      const layer = numberIn(args.layer ?? 0, 0, P.LAYERS - 1, 'layer');
      const assignments = args.assignments || [];

      const result = await session.withDevice(async client => {
        const before = await client.getKeymap(layer);
        const keys = before.keys.map(entry => ({ ...entry }));
        const changes = [];

        for (const assignment of assignments) {
          const slot = await session.resolveSlot(client, assignment);
          const entry = resolveKey(assignment.value);
          const previous = decodeKey(keys[slot].type, keys[slot].code1, keys[slot].code2);
          keys[slot] = entry;
          changes.push({
            slot,
            key: session.nameOfSlot(slot),
            from: previous,
            to: decodeKey(entry.type, entry.code1, entry.code2),
          });
        }

        await client.setKeymap(layer, keys);
        const after = await client.getKeymap(layer);
        const verification = changes.map(change => ({
          ...change,
          verified: decodeKey(
            after.keys[change.slot].type,
            after.keys[change.slot].code1,
            after.keys[change.slot].code2,
          ) === change.to,
        }));
        return { layer, changes: verification, all_verified: verification.every(c => c.verified) };
      });

      const text = result.changes
        .map(change => `${change.key ?? `slot ${change.slot}`}: ${change.from || '(none)'} -> ${change.to}${change.verified ? '' : ' (NOT VERIFIED)'}`)
        .join('\n');
      return { text, structured: result };
    },
  },

  {
    name: 'ronin_lighting_read',
    title: 'Read lighting',
    description:
      'Read the lighting settings of one of the three onboard profiles: effect, brightness, speed, direction, colour and the switch settings.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'integer', minimum: 0, maximum: P.PROFILE_COUNT - 1, description: 'Lighting profile, 0-2. Defaults to the active one.' },
      },
      additionalProperties: false,
    },
    async handler(args, session) {
      const result = await session.withDevice(async client => {
        const base = await client.getDeviceBaseInfo();
        const active = Math.min(P.PROFILE_COUNT - 1, base.profile || 0);
        const profile = args.profile === undefined ? active : numberIn(args.profile, 0, P.PROFILE_COUNT - 1, 'profile');
        const func = await client.getFuncInfo(profile);
        return { profile, active_profile: active, lighting: lightingView(func) };
      });

      const lighting = result.lighting;
      const text = [
        `Profile ${result.profile + 1}${result.profile === result.active_profile ? ' (active)' : ''}: ${lighting.mode_name} (mode ${lighting.mode}), brightness ${lighting.brightness}, speed ${lighting.speed}.`,
        `Direction ${lighting.direction_name}, colour ${lighting.colour.toUpperCase()}, group ${lighting.group_name}${lighting.rainbow ? ', rainbow cycle on' : ''}.`,
        `WASD lighting ${lighting.wasd_lighting ? 'on' : 'off'}, Win lock ${lighting.win_lock ? 'on' : 'off'}, 6K/NK ${lighting.six_key_nk ? 'on' : 'off'}, report rate ${lighting.report_rate_name}, hit rate ${lighting.hit_rate}, hit delay ${lighting.hit_delay}.`,
      ].join('\n');
      return { text, structured: result };
    },
  },

  {
    name: 'ronin_lighting_write',
    title: 'Write lighting',
    description:
      'Change the lighting of a profile and write it to the keyboard. Only the fields you pass are changed; the rest keep their current value. mode accepts an effect name ("Spectrum", "Custom (per-key RGB)") or a number, direction accepts a name ("Clockwise") or a number, colour is "#rrggbb". The profile is read back afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'integer', minimum: 0, maximum: P.PROFILE_COUNT - 1, description: 'Lighting profile, 0-2. Defaults to the active one.' },
        mode: { description: 'Effect name or id. Call ronin_effects for the list.' },
        brightness: { type: 'integer', minimum: 0, maximum: P.MAX_BRIGHTNESS },
        speed: { type: 'integer', minimum: 0, maximum: P.MAX_SPEED },
        direction: { description: 'Direction name or id.' },
        colour: { type: 'string', description: 'Main colour as "#rrggbb".' },
        rainbow: { type: 'boolean', description: 'Run the rainbow colour cycle.' },
        group: { type: 'integer', minimum: 0, maximum: 3, description: 'Lighting group 0-3.' },
        wasd_lighting: { type: 'boolean' },
        win_lock: { type: 'boolean' },
        six_key_nk: { type: 'boolean', description: 'Six key rollover instead of NK.' },
        report_rate: { description: 'Report rate: "125 Hz", "250 Hz", "500 Hz" or "1000 Hz".' },
        hit_rate: { type: 'integer', minimum: 0, maximum: 255 },
        hit_delay: { type: 'integer', minimum: 0, maximum: 255 },
      },
      additionalProperties: false,
    },
    async handler(args, session) {
      const result = await session.withDevice(async client => {
        const base = await client.getDeviceBaseInfo();
        const active = Math.min(P.PROFILE_COUNT - 1, base.profile || 0);
        const profile = args.profile === undefined ? active : numberIn(args.profile, 0, P.PROFILE_COUNT - 1, 'profile');

        const values = {};
        if (args.mode !== undefined) {
          if (typeof args.mode === 'number') {
            values.lightMode = numberIn(args.mode, 0, 255, 'mode');
          } else {
            const wanted = String(args.mode).toLowerCase();
            const effect = effectCatalogue().find(e => e.name.toLowerCase() === wanted || String(e.id) === wanted);
            if (!effect) throw new Error(`Unknown effect "${args.mode}". Call ronin_effects for the list.`);
            values.lightMode = effect.id;
          }
        }
        if (args.brightness !== undefined) values.lightBrightness = numberIn(args.brightness, 0, P.MAX_BRIGHTNESS, 'brightness');
        if (args.speed !== undefined) values.lightSpeed = numberIn(args.speed, 0, P.MAX_SPEED, 'speed');
        if (args.direction !== undefined) {
          if (typeof args.direction === 'number') {
            values.lightDirection = numberIn(args.direction, 0, 255, 'direction');
          } else {
            const wanted = String(args.direction).toLowerCase();
            const found = DIRECTIONS.find(direction => direction.name.toLowerCase() === wanted);
            if (!found) throw new Error(`Unknown direction "${args.direction}". Call ronin_effects for the list.`);
            values.lightDirection = found.value;
          }
        }
        if (args.colour !== undefined) {
          const colour = parseColour(args.colour);
          values.lightR = colour.r;
          values.lightG = colour.g;
          values.lightB = colour.b;
        }
        if (args.rainbow !== undefined) values.mixColor = args.rainbow ? 1 : 0;
        if (args.group !== undefined) values.lightGroup = numberIn(args.group, 0, 3, 'group');
        if (args.wasd_lighting !== undefined) values.keyWasd = args.wasd_lighting ? 1 : 0;
        if (args.win_lock !== undefined) values.lockWin = args.win_lock ? 1 : 0;
        if (args.six_key_nk !== undefined) values.sixKeyNoConflict = args.six_key_nk ? 1 : 0;
        if (args.report_rate !== undefined) {
          if (typeof args.report_rate === 'number') {
            values.reportRate = numberIn(args.report_rate, 0, REPORT_RATES.length - 1, 'report_rate');
          } else {
            const wanted = String(args.report_rate).toLowerCase();
            const found = REPORT_RATES.find(rate => rate.name.toLowerCase() === wanted);
            if (!found) throw new Error(`Unknown report rate "${args.report_rate}".`);
            values.reportRate = found.value;
          }
        }
        if (args.hit_rate !== undefined) values.hitRate = numberIn(args.hit_rate, 0, 255, 'hit_rate');
        if (args.hit_delay !== undefined) values.hitDelay = numberIn(args.hit_delay, 0, 255, 'hit_delay');

        if (!Object.keys(values).length) throw new Error('Nothing to change: pass at least one setting.');

        await client.setFuncInfo(values, profile);
        const func = await client.getFuncInfo(profile);
        return { profile, requested: values, lighting: lightingView(func) };
      });

      const lighting = result.lighting;
      const text = `Profile ${result.profile + 1} now: ${lighting.mode_name}, brightness ${lighting.brightness}, speed ${lighting.speed}, direction ${lighting.direction_name}, colour ${lighting.colour.toUpperCase()}.`;
      return { text, structured: result };
    },
  },

  {
    name: 'ronin_colours_read',
    title: 'Read per-key colours',
    description:
      'Read the per-key colour table of the board. Returns the colour of every key that is not black. The table is only visible while the board runs the per-key mode (Custom, mode 19).',
    inputSchema: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Include the black keys as well. Default false.' },
      },
      additionalProperties: false,
    },
    async handler(args, session) {
      const all = !!args.all;
      const result = await session.withDevice(async client => {
        const board = await session.board(client);
        const table = await client.getUserKeyColors();
        const entries = [];
        for (let index = 0; index < table.colors.length; index++) {
          const colour = table.colors[index];
          if (!all && !colour.r && !colour.g && !colour.b) continue;
          const key = session.keyForColourIndex(index);
          entries.push({
            colour_index: index,
            key: key ?? null,
            colour: hexColour(colour.r, colour.g, colour.b),
          });
        }
        return {
          entries,
          lit_keys: entries.filter(entry => entry.colour !== '#000000').length,
          total_slots: table.colors.length,
          board_keys: board.keys.length,
        };
      });

      const text = result.entries.length
        ? result.entries.map(entry => `${entry.key ?? `colour ${entry.colour_index}`}: ${entry.colour.toUpperCase()}`).join('\n')
        : 'The per-key colour table is empty (every key is black).';
      return { text, structured: result };
    },
  },

  {
    name: 'ronin_colours_write',
    title: 'Write per-key colours',
    description:
      'Write the per-key colour table. Use base to paint every key one colour, assignments to paint individual keys ("F5" or a slot number), or grid to paint a picture: an array of rows, each a string of hex colours separated by spaces, mapped onto the physical board. The table is read back afterwards. The board is switched to the per-key mode (Custom, mode 19) unless set_mode is false, because the table is only visible in that mode.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Paint every key this colour, "#rrggbb".' },
        grid: {
          type: 'array',
          items: { type: 'string' },
          description: 'A picture: rows of hex colours separated by spaces, mapped onto the physical board.',
        },
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Physical key name, e.g. "F5".' },
              slot: { type: 'integer', minimum: 0, maximum: P.COLOR_KEYS - 1 },
              colour: { type: 'string', description: 'Colour as "#rrggbb".' },
            },
            required: ['colour'],
            additionalProperties: false,
          },
        },
        set_mode: { type: 'boolean', description: 'Switch the board to the per-key mode. Default true.' },
      },
      additionalProperties: false,
    },
    async handler(args, session) {
      const setMode = args.set_mode !== false;
      const result = await session.withDevice(async client => {
        const current = await client.getUserKeyColors();
        const colours = current.colors.map(colour => ({ ...colour }));

        const baseColour = args.base === undefined ? null : parseColour(args.base);
        if (baseColour) {
          for (let i = 0; i < colours.length; i++) colours[i] = { ...baseColour };
        }
        const changes = [];
        for (const assignment of args.assignments || []) {
          const slot = await session.resolveSlot(client, assignment);
          const index = await session.colourIndex(client, slot);
          if (index === null) {
            throw new Error(`"${assignment.key ?? `slot ${slot}`}" has no per-key colour slot on this board.`);
          }
          const colour = parseColour(assignment.colour);
          colours[index] = colour;
          changes.push({
            colour_index: index,
            slot,
            key: session.nameOfSlot(slot),
            colour: hexColour(colour.r, colour.g, colour.b),
          });
        }
        if (args.grid && args.grid.length) {
          const board = await session.board(client);
          const source = gridSource(args.grid);
          for (const entry of sampleKeys(board.keys, board.width, board.height, source)) {
            const slot = entry.key.slot;
            if (slot === null || slot === undefined) continue;
            const index = await session.colourIndex(client, slot);
            if (index === null) continue;
            colours[index] = { r: entry.r, g: entry.g, b: entry.b };
            changes.push({
              colour_index: index,
              slot,
              key: session.nameOfSlot(slot),
              colour: hexColour(entry.r, entry.g, entry.b),
            });
          }
        }
        if (args.base === undefined && !changes.length) {
          throw new Error('Nothing to paint: pass a base colour, an assignment or a grid.');
        }

        await client.setUserKeyColors(colours);

        let mode = null;
        if (setMode) {
          const func = await client.getFuncInfo(0);
          await client.setFuncInfo({ lightMode: P.MODE_CUSTOM }, 0);
          mode = P.MODE_CUSTOM;
          void func;
        }

        const after = await client.getUserKeyColors();
        const written = changes.map(change => {
          const colour = after.colors[change.colour_index];
          return { ...change, verified: hexColour(colour.r, colour.g, colour.b) === change.colour };
        });
        return {
          base: baseColour ? hexColour(baseColour.r, baseColour.g, baseColour.b) : null,
          changes: written,
          all_verified: written.every(change => change.verified),
          mode,
        };
      });

      const lines = [];
      if (result.base) lines.push(`Every key painted ${result.base.toUpperCase()}.`);
      for (const change of result.changes) {
        lines.push(`${change.key ?? `slot ${change.slot}`}: ${change.colour.toUpperCase()}${change.verified ? '' : ' (NOT VERIFIED)'}`);
      }
      if (result.mode !== null) lines.push('Board switched to the per-key mode (19).');
      return { text: lines.join('\n'), structured: result };
    },
  },

  {
    name: 'ronin_light_matrix_read',
    title: 'Read light matrix',
    description:
      'Read the light matrix: which colour index the firmware uses for each key. Keys with no per-key colour slot show 255.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(args, session) {
      const result = await session.withDevice(async client => {
        const matrix = await client.getLightMatrix();
        const entries = matrix
          .map((index, slot) => ({ slot, key: session.nameOfSlot(slot), colour_index: index }))
          .filter(entry => entry.colour_index !== 0xff);
        return { entries, unmapped_slots: matrix.length - entries.length };
      });

      const text = result.entries.length
        ? result.entries.map(entry => `${entry.key ?? `slot ${entry.slot}`}: colour index ${entry.colour_index}`).join('\n')
        : 'The light matrix is empty.';
      return { text, structured: result };
    },
  },

  {
    name: 'ronin_macros_write',
    title: 'Write macros',
    description:
      'Write the macro list to the keyboard. A macro has steps: { kind: "key", code: 4, time: 30 } taps a key (code is the HID usage, 4 is A), { kind: "mouse", button: "left", time: 30 } clicks a mouse button. One step is one action: a tap presses and releases the key, mode "hold" presses without releasing, mode "release" releases without pressing. The keyboard cannot read macros back, so the list you send replaces the stored one.',
    inputSchema: {
      type: 'object',
      properties: {
        macros: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              replayCount: { type: 'integer', minimum: 1, description: 'How often the macro repeats.' },
              loopType: { type: 'integer', minimum: 0, maximum: 2, description: '0 execute N times, 1 loop while held, 2 loop until the same key is pressed.' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['key', 'mouse'] },
                    code: { type: 'integer', description: 'HID usage of the key, 4 is A.' },
                    button: { type: 'string', enum: ['left', 'right', 'middle', 'forward', 'back'] },
                    time: { type: 'integer', minimum: 10, maximum: 50000, description: 'Duration in milliseconds.' },
                    mode: {
                      type: 'string',
                      enum: ['tap', 'hold', 'release'],
                      description: 'tap presses and releases (default), hold presses only, release releases only.',
                    },
                  },
                  required: ['kind'],
                  additionalProperties: false,
                },
              },
            },
            required: ['steps'],
            additionalProperties: false,
          },
        },
      },
      required: ['macros'],
      additionalProperties: false,
    },
    async handler(args, session) {
      const macros = args.macros || [];
      const result = await session.withDevice(async client => {
        await client.setMacros(macros);
        return {
          macros: macros.map((macro, index) => ({
            index,
            name: macro.name || `Macro ${index + 1}`,
            steps: macro.steps.length,
            replayCount: macro.replayCount ?? 1,
            loopType: macro.loopType ?? 0,
          })),
          note: 'The keyboard cannot read macros back, so this is what was sent, not what was read.',
        };
      });

      const text = `Wrote ${result.macros.length} macro(s): ` +
        result.macros.map(macro => `${macro.name} (${macro.steps} steps)`).join(', ') + '.';
      return { text, structured: result };
    },
  },

  {
    name: 'ronin_restore_factory',
    title: 'Factory reset',
    description:
      'Reset the keyboard to its factory settings. This clears every layer, colour and macro. It cannot be undone, so confirm with the user first.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', description: 'Must be true. Confirms the destructive reset.' },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
    async handler(args, session) {
      if (args.confirm !== true) {
        throw new Error('Factory reset needs confirm: true. Ask the user first - it clears every layer, colour and macro.');
      }
      const result = await session.withDevice(async client => {
        await client.startComm();
        await client.request(0, P.CMD.RESTORE_FACTORY_SETTINGS, 0, [0, 0]);
        await client.stopComm();
        return { reset: true };
      });
      return { text: 'Factory reset sent. The keyboard is back to its shipped state.', structured: result };
    },
  },
];

/** Run a tool and return the MCP result payload. */
export async function callTool(tool, args, session) {
  const result = await tool.handler(args, session);
  return {
    content: [{ type: 'text', text: result.text }],
    structuredContent: result.structured,
  };
}
