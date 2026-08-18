import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers.mjs';

const { splitWords, wordTransformers } = await loadModule(`export * from './src/utils/case';`);

test('splitWords: 驼峰/帕斯卡/分隔符混合', () => {
  assert.deepEqual(splitWords('helloWorld'), ['hello', 'World']);
  assert.deepEqual(splitWords('HelloWorld'), ['Hello', 'World']);
  assert.deepEqual(splitWords('hello-world'), ['hello', 'world']);
  assert.deepEqual(splitWords('hello_world'), ['hello', 'world']);
  assert.deepEqual(splitWords('hello.world'), ['hello', 'world']);
  assert.deepEqual(splitWords('hello/world'), ['hello', 'world']);
  assert.deepEqual(splitWords('hello\\world'), ['hello', 'world']);
  assert.deepEqual(splitWords('helloWorld42'), ['hello', 'World42']); // 末尾数字与单词连在一起
  assert.deepEqual(splitWords('HTMLParser'), ['HTML', 'Parser']); // 连续大写后接小写
  assert.deepEqual(splitWords('ABCCode'), ['ABC', 'Code']);
  assert.deepEqual(splitWords('already-snake_case.mixed/path'), [
    'already',
    'snake',
    'case',
    'mixed',
    'path',
  ]);
  assert.deepEqual(splitWords(''), []); // 空串
  assert.deepEqual(splitWords('   '), []); // 仅空白
});

test('wordTransformers: 各格式基本转换', () => {
  const t = wordTransformers;
  assert.equal(t['Camel Case']('hello world'), 'helloWorld');
  assert.equal(t['Pascal Case']('hello world'), 'HelloWorld');
  assert.equal(t['Kebab Case']('hello world'), 'hello-world');
  assert.equal(t['Snake Case']('hello world'), 'hello_world');
  assert.equal(t['Constant Case']('hello world'), 'HELLO_WORLD');
  assert.equal(t['Upper Case']('hello world'), 'HELLOWORLD');
  assert.equal(t['Lower Case']('hello world'), 'helloworld');
  assert.equal(t['Title Case']('hello world'), 'Hello World');
  assert.equal(t['Sentence Case']('hello world foo'), 'Hello world foo');
  assert.equal(t['Header Case']('hello world'), 'Hello-World');
  assert.equal(t['Dot Case']('hello world'), 'hello.world');
  assert.equal(t['Path Case']('hello world'), 'hello/world');
});

test('wordTransformers: 极端输入（空串/单字符/数字）', () => {
  const t = wordTransformers;
  for (const name of Object.keys(t)) {
    assert.equal(t[name](''), '', `${name} 空串应返回空`);
    assert.equal(typeof t[name]('a'), 'string', `${name} 单字符应返回字符串`);
    assert.equal(t[name]('a').length, 1, `${name} 单字符长度应为 1`);
    assert.equal(t[name]('123'), '123', `${name} 纯数字应保持不变`);
  }
});

test('wordTransformers: 已处于目标格式时幂等', () => {
  const t = wordTransformers;
  assert.equal(t['Camel Case']('helloWorld'), 'helloWorld');
  assert.equal(t['Snake Case']('hello_world'), 'hello_world');
  assert.equal(t['Kebab Case']('hello-world'), 'hello-world');
  assert.equal(t['Pascal Case']('HelloWorld'), 'HelloWorld');
  assert.equal(t['Constant Case']('HELLO_WORLD'), 'HELLO_WORLD');
});

test('wordTransformers: 含大写/特殊前缀的单词', () => {
  const t = wordTransformers;
  // 帕斯卡转蛇形：首字母保持
  assert.equal(t['Snake Case']('HelloWorld'), 'hello_world');
  // 常量格式：全大写下划线
  assert.equal(t['Constant Case']('myVarName'), 'MY_VAR_NAME');
  // 点格式与路径格式保持小写
  assert.equal(t['Dot Case']('MyComponent'), 'my.component');
  assert.equal(t['Path Case']('MyComponent'), 'my/component');
});
