import { Bench } from 'tinybench';
import { createStore } from "autostore"
import { derive, share } from 'helux';
import { MobxStore } from './mobx.store';


const bench = new Bench({ 
  time: 1000, 
  iterations: 1,
});

bench   
  // *********  基本的依赖计算  *********  
  .add('[AutoStore] 简单的依赖计算', () => { 
    const store = createStore({ 
        a: 50,
        b: (scope:any)=>{
          return scope.a + 1
        }
    });
    for(let i = 1; i <= 1000; i++){      
      store.state.a = i
    } 
  }) 
  .add('[Helux] 简单的依赖计算', () => { 
    const [a,setA] = share({
        value: 0
      });
      const b = derive(() => {
        return a.value+1
      }); 
      for(let i = 1; i <= 1000; i++){
        setA(draft=>{
              draft.value = i
          }) 
      } 
  }) 
  .add('[Mobx] 简单的依赖计算', () => { 
    const store = new MobxStore();
    for (let i = 1; i <= 1000; i++) {
      store.setA0(i); 
    }
  })     
  // *********  多重依赖链计算  *********  
  .add('[AutoStore] 多重依赖链计算', () => { 
    const store = createStore({ 
        a0: 50,
        a1: (scope:any)=>{
          return scope.a0 + 1
        },
        a2: (scope:any)=>scope.a1 + 1,
        a3: (scope:any)=>scope.a2 + 1,
        a4: (scope:any)=>scope.a3 + 1,
        a5: (scope:any)=>scope.a4 + 1,
        a6: (scope:any)=>scope.a5 + 1,
        a7: (scope:any)=>scope.a6 + 1,
        a8: (scope:any)=>scope.a7 + 1,
        a9: (scope:any)=>scope.a8 + 1,
        a10: (scope:any)=>scope.a9 + 1,
    });
    for(let i = 1; i <= 1000; i++){      
      store.state.a0 = i
    } 
  }) 
  .add('[Helux] 多重依赖链计算', () => { 
    const [a0,setA0] = share({
        value: 0
      });
      const a1 = derive(() => {
        return a0.value+1
      });
      const a2 = derive(() =>a1.val+1)
      const a3 = derive(() =>a2.val+1)
      const a4 = derive(() =>a3.val+1)
      const a5 = derive(() =>a4.val+1)
      const a6 = derive(() =>a5.val+1)
      const a7 = derive(() =>a6.val+1)
      const a8 = derive(() =>a7.val+1)
      const a9 = derive(() =>a8.val+1)
      const a10 = derive(() =>{
        return a9.val+1
    }) 
    for(let i = 1; i <= 1000; i++){
      setA0(draft=>{
            draft.value = i
        }) 
    } 
  })   
await bench.warmup(); // make results more reliable, ref: https://github.com/tinylibs/tinybench/pull/50
await bench.run();

console.table(bench.table());
 