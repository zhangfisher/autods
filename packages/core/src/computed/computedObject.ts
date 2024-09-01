/**
 * 
 * 
 * 
 */
import { DynamicValueObject } from "../dynamic/valueObject"
import { joinValuePath } from "../utils/joinValuePath";
import {  ComputedOptions } from './types';

 

export class ComputedObject<Value=any,Scope=any> extends DynamicValueObject<Value,Scope,ComputedOptions<Value,Scope>>{    
    protected onInitial(){
      
    } 

    /**
     * 手动触发计算属性getter函数的重新执行，重新计算计算属性的值
     * 
     * @description
     */
    run(){
         
    }
    toString(){ return `ComputedObject<${joinValuePath(this.path)}>` }

}