# vue-property-decorator-transpiler

Transpiles classes written in [vue-property-decorator](https://www.npmjs.com/package/vue-property-decorator) back to simple Vue component global registration.

I created this package because I really enjoy the coding experience of vue-property-decorator, but I really don't like the way it runs, with all the modules and requirings etc. I want to develop using vue-property-decorator, but end up with the old-fashioned Vue component global registration code, and this package does exactly that.

For the moment this package does not fully support all syntaxes of vue-property-decorator, and everything that is currently supported is demonstrated in the example below.

## License

MIT License

## Install

```bash
npm install vue-property-decorator-transpiler --save-dev
```

## Usage

```javascript
var transpiler = require('vue-property-decorator-transpiler');
var result = transpiler(code);
```

Since version 2, you can pass a template string to `transpiler` as a second argument, and it will be precompiled into render function in the resulted code.

Now if the `code` looks like this:

```typescript
import { Component, Vue, Prop, Watch, Provide, Inject } from 'vue-property-decorator';

@Component({
	name: "test",
	template: "#testTemplate"
})
export default class TestComponent extends Vue {
	@Prop(Object) readonly prop!: Object;
	@Prop(String) readonly text: string = "default";		// one way to define default value
	@Prop({default: "default"}) readonly text2!: string;	// another way to define default value

	// I add "private" or "public" just to remind myself of different
	// types of declarations. It makes no difference to the transpiler.
	private field: string = "abc";

	@Provide('foo') foo = 'foo';

	@Inject('bar') readonly bar!: string;

	get computed() { return 123; }

	// Transpiler recognizes all default events of Vue.
	private created() { console.log("created"); }

	// Transpiler will drop the name of the methods decorated by @Watch
	@Watch('field') onFieldChanged(v: string) {
		console.log("field: " + v);
	}

	public method() {
		console.log("method called.");
	}
};
```

The `result` will look like this (formatted for clarity; the package does not format the output code, so that you can use any other package for that purpose)

```javascript
Vue.component('test', {
	template: '#testTemplate',
	data() {
		return {
			field: "abc",
			foo: 'foo'
		};
	},
	props: {
		prop: Object,
		text: {
			type: String,
			default: "default"
		},
		text2: {
			default: "default"
		}
	},
	provide() {
		return {
			'foo': this.foo
		};
	},
	inject: {
		bar: 'bar'
	},
	watch: {
		'field'(v) {
			console.log("field: " + v);
		}
	},
	computed: {
		computed() { return 123; }
	},
	methods: {
		method() {
			console.log("method called.");
		}
	},
	created() { console.log("created"); }
});
```

If the `name` option is not specified in the `@Component` declaration, it will use the lowercased class name as the name of the component; and if the `template` option is not spcified, it will assume that the template has an id equals to the name of the component.