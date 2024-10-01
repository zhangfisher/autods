/**
 *
 * 异步计算
 *
 *
 *
 *
 *
 */
import { isPathEq, markRaw} from "../utils";
import { delay } from "flex-tools/async/delay";
import { getValueScope } from "../scope";
import { ComputedProgressbar } from "./types";
import type { AsyncComputedGetterArgs, AsyncComputedValue, RuntimeComputedOptions } from "./types";
import { ComputedObject } from "./computedObject";
import { Dict } from "../types";
import { getSnap } from "../utils/getSnap";
import { getError } from "../utils/getError";
import { StateOperateParams } from "../store/types";
import { updateObjectVal } from "../utils/updateObjectVal";
import { ASYNC_COMPUTED_VALUE, PATH_DELIMITER } from "../consts";
import { AbortError } from "../errors"; 

type GetterRunContext = {
	error 	      : any;
	isError       : boolean;
	isTimeout     : boolean;
	isAbort       : boolean;
	timeoutCallback: Function | undefined;
};

export class AsyncComputedObject<Value = any, Scope = any> extends ComputedObject<AsyncComputedValue<Value>> {
	private _isComputedRunning: boolean = false;
	private _abortController: AbortController | null = null; 

	get async() {return true}       
	get value() {return super.value as AsyncComputedValue<Value>}
	set value(value:AsyncComputedValue<Value>) {
		super.value = value
	}
	/**
	 *
	 */
	protected onInitial() {
		this.initial = this.createAsyncComputedValue();
		this.attach()
		// 为什么要延迟执行？
		// 因为onInitial函数是在第一次读取时执行的同步操作，此时的依赖项还没有收集完毕，原始的计算函数还没有初始化
		// 比如{ total:computed(async()=>{ return 1+2 }) }，在第一次读取total时，此时的computed函数还没有初始化
		// 如果这时候执行run，则total的值还是一个function，而run执行时会将运行的数据更新到total.value，total.loading 等值，
		// 由于total还没有初始化为{loading,value,....}对象，所以会出错
		setImmediate(()=>{
			if (this.options.immediate===true || (this.options.immediate==='auto' && this.options.initial===undefined)) {
				this.run({first:true});
			}
		})		
	}
	private createAsyncComputedValue() {
		return Object.assign({
			[ASYNC_COMPUTED_VALUE]:true,
			loading : false,
			timeout : 0,
			retry   : 0,
			error   : null,
			value   : this.options.initial,
			progress: 0,
			run     : markRaw((args: Dict) => {
				return this.store.computedObjects.run(this.id, Object.assign({}, args));
			}),
			cancel: markRaw(() => {
				
			})
		});
	} 

	private updateComputedValue(values: Partial<AsyncComputedValue>) {    		
		const batchEvent = this.strPath
		if(this.associated){			
			this.store.update((state)=>{
				updateObjectVal(state, this.path!, values);
			},{batch:batchEvent})			
		}else{
			Object.assign(this.value as object,values)		
			Object.entries(values).forEach(([key,value])=>{
				this.store.changesets.emit(
					`${this.strPath}.${key}`,
					{type:"set",path:[this.strPath,key],value:value,parent:this.value})
			})
			this.store.changesets.emit(batchEvent,{type:"batch",path:this.path,value:this.value})	
		}		
  	}

	

	/**
	 *
	 * 运行计算函数
	 *
	 */
	async run(options?: RuntimeComputedOptions) {
		const { first = false } = options ?? {};
		// 1. 检查是否计算被禁用, 注意，仅点非初始化时才检查计算开关，因为第一次运行需要收集依赖，这样才能在后续运行时，随时启用/禁用计算属性
		if (this.isDisable(options?.enable)) {
			this.store.log(() => `Async computed <${this.toString()}> is disabled`, "warn");
			return;
		}
		!first && this.store.log(() => `Run async computed for : ${this.toString()}`);

		// 2. 合成最终的配置参数
		const finalComputedOptions = (options ? Object.assign(
			{},
			this.options,
			options
		)  : this.options) as Required<RuntimeComputedOptions>;

		// 3. 根据配置参数获取计算函数的上下文对象
		const scope = getValueScope<AsyncComputedValue<Value>, Scope>(
			this as any,
			"computed",
			this.context,
			finalComputedOptions
		);
		// 4. 检查是否有重入
		const { noReentry } = finalComputedOptions;
		if (noReentry && this._isComputedRunning) {
			this.store.log(() => `Reentry async computed: ${this.toString()}`, "warn");
			this.emitStoreEvent("computed:cancel", { path: this.path, id: this.id, reason: "reentry",computedObject:this });
			return;
		}
		this._isComputedRunning = true; // 即所依赖项的值
		try {
			return await this.executeGetter(scope, finalComputedOptions);
		} finally {
			this._isComputedRunning = false;
		}
	}

	/**
	 * computed(async (scope,{getProgressbar})=>{
	 *    const pbar = getProgressbar({max:100,min:0}) // 初始值
	 *    pbar.value(12)      // 修改进度值
	 *    pbar.end()          // 结束进度条
	 * })
	 *
	 * @param init
	 * @returns
	 */
	private createComputeProgressbar(opts?: {max?: number;min?: number;value?: number;}): ComputedProgressbar {
		const { max = 100, min = 0, value = 0 } = Object.assign({}, opts);
		this.updateComputedValue({"progress":value});
		return {
			value:(num: number)=>{
				if (num > max) num = max;
				if (num < min) num = min;
				this.updateComputedValue({"progress":num});
			},
			end() {
				this.value(max);
			},
		};
	}
	/**
	 * 当计算属性操作完成时的回调函数
	 * 
	 * 此函数负责在计算属性操作完成后，根据操作的执行状态调用用户定义的回调函数
	 * 它会传递操作的结果、错误状态、是否中止以及是否超时等信息给回调函数
	 * 
	 * @param options - 计算属性的运行时选项，被强制转换为Required类型，确保所有选项都是必需的
	 * @param error - 如果操作过程中发生错误，该错误对象将被传递
	 * @param abort - 一个布尔值，表示操作是否被中止
	 * @param timeout - 一个布尔值，表示操作是否因超时而结束
	 * @param scope - 操作执行的上下文或范围
	 * @param value - 操作的结果，如果操作成功完成
	 */
	private onDoneCallback(options: Required<RuntimeComputedOptions>,error:Error,abort:boolean,timeout:boolean,scope:any,value:any) {
		if(typeof(options.onDone)!=='function') return 
		options.onDone.call(this, {
			id  : this.id,			
			path: this.path,
			value,
			error,
			abort,
			timeout,
			scope,
		});
	}
	private getAbortController() {
		if(!this._abortController) this._abortController = new AbortController()
		if(this._abortController.signal.aborted) this._abortController = new AbortController()
		return this._abortController
	}
	/**
	 * 处理超时
	 * @param timeoutCallback 
	 * @param options 
	 * @returns 
	 */
	private setTimeoutControl(ctx:GetterRunContext,initValue:Partial<AsyncComputedValue>,options: Required<RuntimeComputedOptions>){
		const { timeout } = options
		let [timeoutValue = 0, countdown = 0] = Array.isArray(timeout) ? timeout :  [timeout, 0];
		let countdownId:any
		let tmId:any
		if(timeoutValue>0){
			initValue.timeout = countdown > 1 ? countdown : timeoutValue,
			tmId = setTimeout(() => {
				ctx.isTimeout = true;
				if (typeof ctx.timeoutCallback === "function") ctx.timeoutCallback();
				if (!ctx.isError) {  // 没有错误时才更新超时状态
					clearInterval(countdownId);
					this.updateComputedValue({
						loading: false,
						error  : "TIMEOUT",
						timeout: 0,
					});
				}
			}, timeoutValue);
			// 启用设置倒计时:  比如timeout= 6*1000, countdown= 6
			if (countdown > 1) {
				countdownId = setInterval(() => {
					this.updateComputedValue({
						timeout: countdown--,
					});
					if (countdown === 0) clearInterval(countdownId);
				}, timeoutValue / (countdown + 1));
			}
		}
		
		return { 
			clear:()=>{
				clearTimeout(tmId)
				clearInterval(countdownId)
			}
		}
	}
	/**
	 * 执行计算函数
	 *
	 */
	private async executeGetter(scope: any, options: Required<RuntimeComputedOptions>) {
		const { retry = [0, 0],abortController:getAbortController } = options;

		const [retryCount, retryInterval] = Array.isArray(retry) ? retry : [Number(retry), 0];

		let timeoutCallback: Function | undefined; // 异步计算函数可以在超时时执行的回调函数


		let abortController = (getAbortController && getAbortController()) || this.getAbortController();

		const getterArgs: Required<AsyncComputedGetterArgs> = {
			onTimeout     : (cb: Function) => (timeoutCallback = cb),
			getProgressbar: this.createComputeProgressbar.bind(this),
			getSnap       : (scope: any) => getSnap(scope),			
			cancel        : abortController.abort,
			extras        : options.extras,
			changed       : options.changed,
			abortSignal   : abortController.signal
		};

		let hasAbort = false; // 是否接收到可中止信号
		// 侦听中止信号，以便在中止时能停止
		abortController.signal.addEventListener("abort", () => hasAbort = true) 
		
		let timeout = {clear:()=>{}}
		let computedResult: any;

		const ctx :GetterRunContext = {
			error:null,
			isError:false,
			isTimeout:false,
			isAbort:false,
			timeoutCallback,
		} 
		for (let i = 0; i < retryCount + 1; i++) {
			if(i>0){
				Object.assign(ctx, {
					error:null,
					hasError:false,
					hasTimeout:false
				});
			}
			const afterUpdated = {}; // 保存执行完成后需要更新的内容，以便在最后一次执行后更新状态
			try {
				// 1. 初始化数据
				const initValue: Partial<AsyncComputedValue> = {
					loading : true,
					error   : null, 
					progress: 0,
				}
				if(retryCount>0) initValue.retry = i > 0 ? retryCount - i + 1 : 0
				
				timeout = this.setTimeoutControl(ctx,initValue,options)

				this.updateComputedValue(initValue);

				// 如果有中止信号，则取消计算
				if (ctx.isAbort) throw new AbortError()

				// 执行计算函数
				computedResult = await this.getter.call(this, scope, getterArgs);
				if(ctx.isAbort) throw new Error("Abort");
				if (!ctx.isTimeout) {
					Object.assign(afterUpdated, {
						value: computedResult,
						error: null,
						timeout: 0,
					});
				}
			} catch (e: any) { 
				ctx.isError = e;
				if (!ctx.isTimeout) {
					Object.assign(afterUpdated, { error: getError(e).message, timeout: 0 });
				}
			} finally {
				timeout.clear()
				// 重试时不更新loading状态
				if (!ctx.isError || i == retryCount) Object.assign(afterUpdated, { loading: false });
				if (!ctx.isError && !ctx.isTimeout) {
					Object.assign(afterUpdated, { error: null });
				}
				if(retryCount>0 && i===retryCount){
					Object.assign(afterUpdated, { retry: 0 }); 
				}
				this.updateComputedValue(afterUpdated); 
			}
			// 重试延迟
			if (ctx.isError) {// 最后一次不延迟				
				if (retryCount > 0 && retryInterval > 0 && i < retryCount) {
					await delay(retryInterval);
				}
			}
		}
		// 计算完成后触发事件
		if (ctx.isAbort || ctx.isTimeout) {
			this.emitStoreEvent("computed:cancel", { path: this.path, id:this.id, reason: ctx.isTimeout ? "timeout" : "abort" ,computedObject:this});
		} else if (ctx.isError) {
			this.emitStoreEvent("computed:error", { path: this.path, id:this.id, error: ctx.error,computedObject:this });
		} else {
			this.emitStoreEvent("computed:done", { path: this.path, id:this.id, value: computedResult,computedObject:this});		
		} 
	}
	protected onDependsChange(params:StateOperateParams){ 
		this.run({changed:params})		
	}
	/**
	 * 
	 * 由于异步计算是一个对象，所以我们需要侦听的是对象的变化，而不仅是对象的值
	 * 
	 * 
	 * 
	 * 
	 */
	protected getValueWatchPath(){
		const spath = this.path!.join(PATH_DELIMITER)
		return [
			`__${spath}__`,
			`${spath}.*`
		]
	}
	/**
	 * 由于所有异步计算属性均会被转换为一个AsyncComputedValue<{value,timeout,....}>的形式
	 * 这样，当我们在指定一个依赖是异步属性时，就需要指定为xxxx.value才可以个侦听到变化
	 * 
	 * @example
	 * const store = createStore({ 
     *            a0: 1,
     *            a1: computed(async (scope:any)=>{
     *              return scope.a0 + 1
     *            },["a0"],{initial:2}),
     *            a2: computed(async (scope:any)=>{
     *              return scope.a1.value + 1
     *            },["a1.value"],{initial:3})
     *        });
	 * 
	 *  以上a2依赖于a1，由于a1是一个异步对象，所以在写依赖时就必须写上["a1.value"]
	 *  这就有点反直觉了。
	 * 
	 * 本函数在异步计算对象订阅变更事件时调用，用来返回字符串形式的依赖数组
	 * 
	 * 本函数的功能就是对所有依赖进行判断如果其是一个异步计算依赖，则自动添加.value，这样就可以如下方式来写依赖了
	 * 
	 * 	const store = createStore({ 
     *            a0: 1,
     *            a1: computed(async (scope:any)=>{
     *              return scope.a0 + 1
     *            },["a0"],{initial:2}),
     *            a2: computed(async (scope:any)=>{
     *              return scope.a1.value + 1
     *            },["a1"],{initial:3})   
     *        });
	 * 
	 */
	protected getDepends(){
        const depends = super.getDepends()
		return depends.map((dep) => {
			if(dep.length===0) return dep 
			for(let obj of this.store.computedObjects.values()){
				if (isPathEq(obj.path, dep) && obj.async) {
					return [`${dep}.value`]
				}
			} 
			return dep
		}) as unknown as string[][] 
    }
}