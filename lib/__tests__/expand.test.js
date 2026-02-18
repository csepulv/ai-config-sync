import os from 'os';

import { expandServerVars, expandString } from '../expand.js';

describe('expand module', () => {
  describe('expandString', () => {
    test('should expand $VAR from vars', () => {
      const { result } = expandString('$MY_VAR', { MY_VAR: 'hello' }, {});
      expect(result).toBe('hello');
    });

    test('should expand $VAR from env when not in vars', () => {
      const { result } = expandString('$MY_VAR', {}, { MY_VAR: 'from-env' });
      expect(result).toBe('from-env');
    });

    test('should prefer vars over env', () => {
      const { result } = expandString('$MY_VAR', { MY_VAR: 'from-vars' }, { MY_VAR: 'from-env' });
      expect(result).toBe('from-vars');
    });

    test('should expand ${VAR} syntax', () => {
      const { result } = expandString('${MY_VAR}', { MY_VAR: 'hello' }, {});
      expect(result).toBe('hello');
    });

    test('should expand variables embedded in longer strings', () => {
      const { result } = expandString(
        '/home/$USER/.config/$APP/data',
        { USER: 'chris', APP: 'myapp' },
        {}
      );
      expect(result).toBe('/home/chris/.config/myapp/data');
    });

    test('should expand mixed $VAR and ${VAR} in same string', () => {
      const { result } = expandString(
        '$HOME/${APP_DIR}',
        { HOME: '/users/me', APP_DIR: 'app' },
        {}
      );
      expect(result).toBe('/users/me/app');
    });

    test('should expand ~/ at start to home directory', () => {
      const { result } = expandString('~/workspace/project', {}, {});
      expect(result).toBe(os.homedir() + '/workspace/project');
    });

    test('should not expand ~ in the middle of a string', () => {
      const { result } = expandString('/some/~/path', {}, {});
      expect(result).toBe('/some/~/path');
    });

    test('should leave unresolved vars as-is and report them', () => {
      const { result, unresolved } = expandString('$UNKNOWN_VAR', {}, {});
      expect(result).toBe('$UNKNOWN_VAR');
      expect(unresolved).toEqual(['UNKNOWN_VAR']);
    });

    test('should leave unresolved ${VAR} as-is and report them', () => {
      const { result, unresolved } = expandString('${UNKNOWN_VAR}', {}, {});
      expect(result).toBe('${UNKNOWN_VAR}');
      expect(unresolved).toEqual(['UNKNOWN_VAR']);
    });

    test('should report multiple unresolved vars', () => {
      const { result, unresolved } = expandString('$FOO and $BAR', {}, {});
      expect(result).toBe('$FOO and $BAR');
      expect(unresolved).toEqual(['FOO', 'BAR']);
    });

    test('should pass through non-string values unchanged', () => {
      expect(expandString(42, {}, {}).result).toBe(42);
      expect(expandString(null, {}, {}).result).toBeNull();
      expect(expandString(true, {}, {}).result).toBe(true);
      expect(expandString(undefined, {}, {}).unresolved).toEqual([]);
    });

    test('should expand ~/ combined with $VAR', () => {
      const { result } = expandString('~/$APP/config', { APP: 'myapp' }, {});
      expect(result).toBe(os.homedir() + '/myapp/config');
    });

    test('should handle string with no variables', () => {
      const { result, unresolved } = expandString('plain string', {}, {});
      expect(result).toBe('plain string');
      expect(unresolved).toEqual([]);
    });

    test('should handle empty string', () => {
      const { result, unresolved } = expandString('', {}, {});
      expect(result).toBe('');
      expect(unresolved).toEqual([]);
    });
  });

  describe('expandServerVars', () => {
    const vars = { TOKEN: 'secret', DIR: '/custom/dir' };
    const env = { HOME: '/home/user' };

    test('should expand command field', () => {
      const { server } = expandServerVars({ command: '$DIR/bin/server' }, vars, env);
      expect(server.command).toBe('/custom/dir/bin/server');
    });

    test('should expand args items', () => {
      const { server } = expandServerVars(
        {
          command: 'node',
          args: ['$DIR/server.js', '--token', '$TOKEN']
        },
        vars,
        env
      );
      expect(server.args).toEqual(['/custom/dir/server.js', '--token', 'secret']);
    });

    test('should expand env values but not keys', () => {
      const { server } = expandServerVars(
        {
          command: 'npx',
          env: { API_TOKEN: '$TOKEN', PATH_VAR: '$DIR/data' }
        },
        vars,
        env
      );
      expect(server.env).toEqual({
        API_TOKEN: 'secret',
        PATH_VAR: '/custom/dir/data'
      });
    });

    test('should expand url field', () => {
      const { server } = expandServerVars(
        {
          type: 'http',
          url: 'https://api.example.com/$TOKEN/mcp'
        },
        vars,
        env
      );
      expect(server.url).toBe('https://api.example.com/secret/mcp');
    });

    test('should expand headers values but not keys', () => {
      const { server } = expandServerVars(
        {
          type: 'http',
          url: 'https://example.com',
          headers: { Authorization: 'Bearer $TOKEN', 'X-Custom': '$DIR' }
        },
        vars,
        env
      );
      expect(server.headers).toEqual({
        Authorization: 'Bearer secret',
        'X-Custom': '/custom/dir'
      });
    });

    test('should not mutate the original server object', () => {
      const original = {
        command: 'npx',
        args: ['$DIR/server.js'],
        env: { KEY: '$TOKEN' }
      };

      expandServerVars(original, vars, env);

      expect(original.args[0]).toBe('$DIR/server.js');
      expect(original.env.KEY).toBe('$TOKEN');
    });

    test('should collect unresolved vars from all fields', () => {
      const { unresolved } = expandServerVars(
        {
          command: '$UNKNOWN_CMD',
          args: ['$UNKNOWN_ARG'],
          env: { KEY: '$UNKNOWN_ENV' },
          url: '$UNKNOWN_URL',
          headers: { H: '$UNKNOWN_HDR' }
        },
        {},
        {}
      );

      expect(unresolved).toContain('UNKNOWN_CMD');
      expect(unresolved).toContain('UNKNOWN_ARG');
      expect(unresolved).toContain('UNKNOWN_ENV');
      expect(unresolved).toContain('UNKNOWN_URL');
      expect(unresolved).toContain('UNKNOWN_HDR');
    });

    test('should deduplicate unresolved var names', () => {
      const { unresolved } = expandServerVars(
        {
          command: '$MISSING',
          args: ['$MISSING'],
          env: { KEY: '$MISSING' }
        },
        {},
        {}
      );

      expect(unresolved).toEqual(['MISSING']);
    });

    test('should handle server with no expandable fields', () => {
      const original = { name: 'test', command: 'npx', args: ['-y', 'some-mcp'] };
      const { server, unresolved } = expandServerVars(original, {}, {});
      expect(server.command).toBe('npx');
      expect(server.args).toEqual(['-y', 'some-mcp']);
      expect(unresolved).toEqual([]);
    });

    test('should expand ~/ in env values', () => {
      const { server } = expandServerVars(
        {
          command: 'npx',
          env: { MEMORY_FILE: '~/data/memory.jsonl' }
        },
        {},
        {}
      );
      expect(server.env.MEMORY_FILE).toBe(os.homedir() + '/data/memory.jsonl');
    });
  });
});
