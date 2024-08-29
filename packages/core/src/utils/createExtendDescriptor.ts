import { isAsyncFunction } from "./isAsyncFunction";
import { SKIP_PROXY_FLAG, STATE_EXTEND_DESCRIPTOR_FLAG } from "../consts";
import { ComputedDescriptor } from "../computed/types";
import { isExtendDescriptor } from "./isExtendDescriptor";
import { StateExtendDescriptor } from '../extend/types';


export function createExtendDescriptor(value:any): StateExtendDescriptor  | undefined{
    let descriptor : ComputedDescriptor | undefined
    if(isExtendDescriptor(value)){    
        value[SKIP_PROXY_FLAG] = true
        descriptor = value
    }else if(typeof value === 'function'){        
        // 只是简单的函数，没有任何配置参数，则视为是一个计算属性
        descriptor = {
            type             : 'computed',
            getter           : value,
            [STATE_EXTEND_DESCRIPTOR_FLAG]: true,
            [SKIP_PROXY_FLAG]: true,
            options          : {
                async        : isAsyncFunction(value)
            }            
        }
    }
    return descriptor
}
